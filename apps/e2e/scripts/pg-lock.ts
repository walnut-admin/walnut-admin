/**
 * E2E 库的**会话级互斥锁**（PG advisory lock）与维护连接。
 *
 * 为什么需要锁：prepare-db 的 `DROP DATABASE ... WITH (FORCE)` 与整轮用例都假设
 * 「这个库此刻只属于我」。两个 worktree 各跑一次 E2E 时，第二个进程的 prepare 会把
 * 第一个正在用的库删掉——用例不会立刻红，而是读到一个刚建好的空库，报出难以归因的失败。
 * 所以**锁的生命周期 = 一整轮 run**（含 playwright test），而不是只罩住 prepare。
 *
 * **两把锁（P1-6 Phase A，作用域 = 同一个 PG 实例）**：
 * - **全局 run 锁**（`2026112401`）：每条 run 先抢，语义是「这台机器的这个数据栈上同时只有一个
 *   E2E run」——不变量 6 原样保留。本地多 profile 仍**串行**：第二个 profile 在第一步等全局锁，
 *   120s 内抢不到就报持锁者退出。profile 锁不是并发通行证。
 * - **profile 锁**（`2026112401 + profile 序号`）：拿到全局锁之后再抢，语义是「这个库此刻只有
 *   一个 owner」。CI 每个 job 是独立 PG 实例，全局锁天然无竞争，profile 锁的价值是日志归属
 *   （报持锁者时能看出是哪个 profile）与同 profile 重入保护。`default` 的 profile 锁与全局锁
 *   同 key，跳过重复抢。
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
import { E2E_PG_GLOBAL_LOCK_KEY, STACK_PROFILE } from './stack-profiles.ts'

/** 全局 advisory lock 的 key（「一台机器一个全量 run」；只在 E2E 内使用） */
export const E2E_PG_LOCK_KEY = E2E_PG_GLOBAL_LOCK_KEY
/** 当前 profile 的锁 key（default = 全局 key；命名 profile 是全局 key + 序号） */
export const E2E_PROFILE_LOCK_KEY = STACK_PROFILE.lockKey
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

/** 抢锁（轮询；抢不到时打印持锁者）。`label` 只用于日志归属（全局 / profile 名）。 */
export async function acquirePgLock(client: Client, key = E2E_PG_LOCK_KEY, label = 'run'): Promise<void> {
  const started = Date.now()

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key])
    if (rows[0]?.locked === true) {
      log(`已拿到 PG advisory lock（key=${key}，${label}）`)
      return
    }

    if (Date.now() - started > LOCK_WAIT_MS) {
      const holders = await client.query<{ pid: number, state: string, query: string }>(
        `SELECT a.pid, a.state, a.query
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.objid = $1`,
        [key],
      )
      const detail = holders.rows.map(row => `pid=${row.pid} state=${row.state} query=${row.query.slice(0, 120)}`).join('; ')
      throw new E2ePreconditionError(
        `${LOCK_WAIT_MS / 1000}s 内没抢到 PG advisory lock（${label}，key=${key}）—— 另一个 E2E 进程正在跑这一轮？${detail}`,
      )
    }

    log(`另一个 E2E 进程持锁中（${label}，key=${key}），2s 后重试……`)
    await sleep(LOCK_POLL_MS)
  }
}

/** 释放锁（失败只 warn：连接断掉时锁会随会话一起消失，不值得再抛） */
export async function releasePgLock(client: Client, key = E2E_PG_LOCK_KEY): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [key])
  }
  catch (error) {
    warn(`释放 advisory lock（key=${key}）失败（连接已断时会自动释放）：${error instanceof Error ? error.message : String(error)}`)
  }
}
