/**
 * E2E 库的**会话级互斥锁**（PG advisory lock）与维护连接。
 *
 * 为什么是一把锁而不是两把：prepare-db 的 `DROP DATABASE ... WITH (FORCE)` 与整轮用例都
 * 假设「这个库此刻只属于我」。两个 worktree 各跑一次 E2E 时，第二个进程的 prepare 会把
 * 第一个正在用的库删掉——用例不会立刻红，而是读到一个刚建好的空库，报出难以归因的失败。
 * 所以**锁的生命周期 = 一整轮 run**（含 playwright test），而不是只罩住 prepare。
 *
 * 谁持有：
 * - `scripts/run.ts` 先抢锁，再把「锁已在手」告诉 `prepareDatabase()`（它因此跳过自己那一步），
 *   整轮结束后释放；
 * - 单独跑 `node scripts/prepare-db.ts` 时由它自己抢 / 放（只罩住重建那一段）。
 *
 * 抢不到时**不静默等待**：轮询到上限就打印持锁者的 pid / state / query，让人能判断
 * 是另一个 worktree 在跑，还是上一轮崩了留下的半开连接。
 */
import { Client } from 'pg'
import {
  E2E_PG_DB,
  E2E_PG_HOST,
  E2E_PG_PASS,
  E2E_PG_PORT,
  E2E_PG_USER,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'

/** advisory lock 的 key（任意固定大整数；只在 E2E 内使用，别与集成测试的 key 撞） */
export const E2E_PG_LOCK_KEY = 2026112401
/** 抢锁等待上限：超过就报「谁在持锁」而不是无限等 */
const LOCK_WAIT_MS = 120_000
const LOCK_POLL_MS = 2_000
/** 管理通道连到维护库（DROP/CREATE DATABASE 不能连目标库本身） */
const MAINTENANCE_DB = 'postgres'

function log(message: string): void {
  console.log(`[e2e/lock] ${message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function warn(message: string): void {
  console.warn(`[e2e/lock] ${message}`)
}

/**
 * 维护通道连接（不连目标库）。连不上是**前置条件**问题（数据栈没起来），折成退出码 2。
 */
export async function connectMaintenance(): Promise<Client> {
  const client = new Client({
    host: E2E_PG_HOST,
    port: E2E_PG_PORT,
    user: E2E_PG_USER,
    password: E2E_PG_PASS,
    database: MAINTENANCE_DB,
    // 连不上时不要挂到 OS 默认超时（那是分钟级）：数据栈没起来要在秒级给出可读报错
    connectionTimeoutMillis: 5_000,
  })

  try {
    await client.connect()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new E2ePreconditionError(
      `连不上 PG ${E2E_PG_HOST}:${E2E_PG_PORT}（库 ${E2E_PG_DB} 的管理通道）：${message}\n`
      + '  处置：先起数据栈（见 apps/e2e/README.md 的「数据栈的两种形态」），再确认容器 healthy。',
    )
  }

  return client
}

/** 抢锁（轮询；抢不到时打印持锁者） */
export async function acquirePgLock(client: Client): Promise<void> {
  const started = Date.now()

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [E2E_PG_LOCK_KEY])
    if (rows[0]?.locked === true) {
      log(`已拿到 PG advisory lock（key=${E2E_PG_LOCK_KEY}）`)
      return
    }

    if (Date.now() - started > LOCK_WAIT_MS) {
      const holders = await client.query<{ pid: number, state: string, query: string }>(
        `SELECT a.pid, a.state, a.query
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.objid = $1`,
        [E2E_PG_LOCK_KEY],
      )
      const detail = holders.rows.map(row => `pid=${row.pid} state=${row.state} query=${row.query.slice(0, 120)}`).join('; ')
      throw new E2ePreconditionError(
        `${LOCK_WAIT_MS / 1000}s 内没抢到 PG advisory lock —— 另一个 E2E 进程正在跑这一轮？${detail}`,
      )
    }

    log('另一个 E2E 进程持锁中，2s 后重试……')
    await sleep(LOCK_POLL_MS)
  }
}

/** 释放锁（失败只 warn：连接断掉时锁会随会话一起消失，不值得再抛） */
export async function releasePgLock(client: Client): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [E2E_PG_LOCK_KEY])
  }
  catch (error) {
    warn(`释放 advisory lock 失败（连接已断时会自动释放）：${error instanceof Error ? error.message : String(error)}`)
  }
}
