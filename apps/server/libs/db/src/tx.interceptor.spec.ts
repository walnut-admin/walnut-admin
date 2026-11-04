import type { CallHandler, ExecutionContext } from '@nestjs/common'
import type { DataSource, QueryRunner } from 'typeorm'
import { Logger } from '@nestjs/common'
import { from, lastValueFrom } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalnutTxInterceptor } from './tx.interceptor'

/**
 * WalnutTxInterceptor 失败路径的**连接语义**回归 —— 「池污染」专项。
 *
 * bug 形态（历史上的生产故障）：拦截器 `startTransaction()` 成功后，catch 里**只
 * `release()` 不 `rollback()`**。TypeORM 的 `release()`（1.1.2 的
 * `PostgresQueryRunner.releasePostgresConnection()`，PostgresQueryRunner.js:93-105）只把
 * client 还给 pg-pool、把 runner 摘出 driver 的活跃清单：**不发 ROLLBACK，也不清
 * `isTransactionActive`**。于是这条「带着未提交事务回池」的连接被下一个借主拿走 ——
 * PG 对事务块内的 `START TRANSACTION` 只给 WARNING + no-op，借主看不出自己在别人的未提交
 * 事务里，它的语句（含 seed / 业务写）全落进那个事务：别人看不见、自己也不提交。
 * 实测症状就是 concurrency 集成用例的 `expected 3 to be 1003`（种子 INSERT 没提交）。
 *
 * 本 spec 用**忠实于 1.1.2 语义**的假 runner 直接驱动拦截器：
 * - `startTransaction` 先置 `isTransactionActive = true` 再发语句（语句失败时标志仍是 true）；
 * - `rollbackTransaction` 在事务未开启时**抛** `TransactionNotStartedError`（不是 no-op）；
 * - `release` 记录「还池那一刻 isTransactionActive 是什么」—— 这就是池污染判据。
 *
 * 负对照：删掉 tx.interceptor.ts 里 `rollbackIfActive()` 的调用 / 它的 rollback 语句，
 * 本文件前三条用例当场变红（顺序与「还池时不带事务」两个断言都会失败）。
 */

interface IFakeRunnerScript {
  /** connect 抛错（会话未建立，事务从未开启） */
  connectThrows?: boolean
  /** startTransaction 抛错（1.1.2 此时 isTransactionActive 已经是 true） */
  startThrows?: boolean
  /** RLS 设置（manager.query）抛错 —— 拦截器 try 块内、startTransaction 之后的失败 */
  setupThrows?: boolean
  /** rollback 自身抛错（连接已坏） */
  rollbackThrows?: boolean
  /** commit 抛错 */
  commitThrows?: boolean
}

interface IFakeRunnerHandle {
  runner: QueryRunner
  calls: string[]
  /** 每次 release 那一刻的 isTransactionActive（应为 [false]：还池的连接不能带事务） */
  activeAtRelease: boolean[]
}

function createFakeRunner(script: IFakeRunnerScript = {}): IFakeRunnerHandle {
  const calls: string[] = []
  const activeAtRelease: boolean[] = []
  // 状态放独立对象：避免 runner 字面量在自己的初始化器里引用自己（TS7022 循环推断）
  const state = { active: false, released: false }

  const runner = {
    get isTransactionActive() {
      return state.active
    },
    get isReleased() {
      return state.released
    },
    async connect() {
      calls.push('connect')
      if (script.connectThrows === true) {
        throw new Error('pg connect boom')
      }
    },
    async startTransaction() {
      calls.push('start')
      // 与 1.1.2 同序：先置位，再发 START TRANSACTION（语句失败时标志保持 true）
      state.active = true
      if (script.startThrows === true) {
        throw new Error('pg start boom')
      }
    },
    async commitTransaction() {
      calls.push('commit')
      if (script.commitThrows === true) {
        throw new Error('pg commit boom')
      }
      state.active = false
    },
    async rollbackTransaction() {
      calls.push('rollback')
      if (!state.active) {
        // 1.1.2 的真实语义：事务未开启时抛错，不是静默 no-op
        throw new Error('TransactionNotStartedError')
      }
      if (script.rollbackThrows === true) {
        throw new Error('pg rollback boom')
      }
      state.active = false
    },
    async release() {
      calls.push('release')
      activeAtRelease.push(state.active)
      state.released = true
    },
    manager: {
      query: async () => {
        if (script.setupThrows === true) {
          throw new Error('pg set_config boom')
        }
        return []
      },
    },
  } as unknown as QueryRunner

  return { runner, calls, activeAtRelease }
}

function fakeDataSource(runner: QueryRunner): DataSource {
  return { createQueryRunner: () => runner } as unknown as DataSource
}

function makeExecutionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getClass: () => class SpecTxHandler { },
    getHandler: () => function specTxHandler() { },
  } as unknown as ExecutionContext
}

/** handler 正常返回（setup 失败用例用不到，给个能订阅的下限实现） */
function okHandler(value: unknown = 'ok'): CallHandler {
  return { handle: () => from(Promise.resolve(value)) }
}

/** handler 抛错（catchError 路径） */
function failingHandler(message: string): CallHandler {
  return { handle: () => from(Promise.reject(new Error(message))) }
}

describe('walnutTxInterceptor 失败路径的连接语义（先 rollback 再 release）', () => {
  beforeEach(() => {
    // 拦截器会 log（commit / abort）与 error（rollback 失败）—— 断言与输出无关，静音
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setup 阶段抛错（startTransaction 已成功）：先 rollback 再 release，还池的连接不带事务', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ setupThrows: true })
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    await expect(interceptor.intercept(makeExecutionContext({}), okHandler()))
      .rejects
      .toThrow('pg set_config boom')

    // 池污染判据（先断言它 —— 这才是生产症状）：还池那一刻连接上不能还有活跃事务
    expect(activeAtRelease).toEqual([false])
    // 顺序判据：rollback 必须在 release 之前
    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
    // release 只发生一次
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('handler 抛错（catchError 路径）：同样先 rollback 再 release，还池的连接不带事务', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner()
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    const result$ = await interceptor.intercept(makeExecutionContext({}), failingHandler('handler boom'))
    await expect(lastValueFrom(result$)).rejects.toThrow('handler boom')

    expect(activeAtRelease).toEqual([false])
    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('rollback 自身抛错：不掩盖原始错误，release 仍然发生且只一次', async () => {
    const { runner, calls } = createFakeRunner({ setupThrows: true, rollbackThrows: true })
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    // 透传的必须是 setup 的错，不是 'pg rollback boom'
    await expect(interceptor.intercept(makeExecutionContext({}), okHandler()))
      .rejects
      .toThrow('pg set_config boom')

    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('connect 抛错（事务从未开启）：不 rollback（1.1.2 会抛 TransactionNotStartedError），release 一次', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ connectThrows: true })
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    await expect(interceptor.intercept(makeExecutionContext({}), okHandler()))
      .rejects
      .toThrow('pg connect boom')

    expect(calls).toEqual(['connect', 'release'])
    expect(activeAtRelease).toEqual([false])
  })

  it('startTransaction 抛错（1.1.2 已置 isTransactionActive）：仍要 rollback 再 release', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ startThrows: true })
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    await expect(interceptor.intercept(makeExecutionContext({}), okHandler()))
      .rejects
      .toThrow('pg start boom')

    expect(activeAtRelease).toEqual([false])
    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
  })

  it('commit 成功：release 一次、不 rollback', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner()
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    const result$ = await interceptor.intercept(makeExecutionContext({}), okHandler('committed'))
    await expect(lastValueFrom(result$)).resolves.toBe('committed')

    expect(calls).toEqual(['connect', 'start', 'commit', 'release'])
    expect(activeAtRelease).toEqual([false])
  })

  it('commit 抛错：原始错误透传，release 一次，已释放的 runner 不再 rollback（守卫）', async () => {
    const { runner, calls } = createFakeRunner({ commitThrows: true })
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))

    const result$ = await interceptor.intercept(makeExecutionContext({}), okHandler())
    await expect(lastValueFrom(result$)).rejects.toThrow('pg commit boom')

    expect(calls).toEqual(['connect', 'start', 'commit', 'release'])
    expect(calls).not.toContain('rollback')
  })

  it('setup 阶段同步错误（RLS 设置抛 TypeError）同样走 rollback → release', async () => {
    // 与集成用例同源的触发方式：RLS 设置为畸形值（deptIds 非数组）
    const { runner, calls, activeAtRelease } = createFakeRunner()
    const interceptor = new WalnutTxInterceptor(fakeDataSource(runner))
    const request = { dataScopeRls: { mode: 'system', userId: '', deptIds: null } }

    await expect(interceptor.intercept(makeExecutionContext(request), okHandler()))
      .rejects
      .toThrow(TypeError)

    expect(activeAtRelease).toEqual([false])
    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
  })
})
