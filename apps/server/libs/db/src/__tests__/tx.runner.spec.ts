import type { DataSource, QueryRunner } from 'typeorm'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryRunnerTxGuard, withQueryRunnerTransaction } from '../tx.runner'

/**
 * `withQueryRunnerTransaction` / `createQueryRunnerTxGuard` 的生命周期判据。
 *
 * 假 runner 忠实复刻 TypeORM 1.1.2 的语义（与 `tx.interceptor.spec.ts` 同一套）：
 * - `startTransaction` 先置 `isTransactionActive = true` 再发语句（语句失败时标志仍是 true）；
 * - `rollbackTransaction` 在事务未开启时**抛** TransactionNotStartedError（不是 no-op）；
 * - `release` 记录「还池那一刻 isTransactionActive 是什么」—— 这就是池污染判据：
 *   只 release 不 rollback 的实现在这里读到 `true`。
 *
 * 负对照：把 `withQueryRunnerTransaction` 的 catch 分支删掉（只 release 不 rollback），
 * 「fn 抛错」「setup 抛错」「commit 抛错」三条用例的 `activeAtRelease` 立刻变 `[true]`。
 */

interface IFakeRunnerScript {
  /** connect 抛错（会话未建立，事务从未开启） */
  connectThrows?: boolean
  /** startTransaction 抛错（1.1.2 此时 isTransactionActive 已经是 true） */
  startThrows?: boolean
  /** setup（RLS 设置）抛错 */
  setupThrows?: boolean
  /** commit 抛错 */
  commitThrows?: boolean
  /** rollback 自身抛错（连接已坏） */
  rollbackThrows?: boolean
  /** release 自身抛错 */
  releaseThrows?: boolean
}

interface IFakeRunnerHandle {
  runner: QueryRunner
  calls: string[]
  /** 每次 release 那一刻的 isTransactionActive（必须是 [false]：还池的连接不能带事务） */
  activeAtRelease: boolean[]
}

function createFakeRunner(script: IFakeRunnerScript = {}): IFakeRunnerHandle {
  const calls: string[] = []
  const activeAtRelease: boolean[] = []
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
      if (script.releaseThrows === true) {
        throw new Error('pg release boom')
      }
    },
    async query(sql: string) {
      calls.push(`query:${sql}`)
    },
    manager: {
      query: async () => {
        calls.push('set_config')
        if (script.setupThrows === true) {
          throw new Error('pg set_config boom')
        }
        return []
      },
    },
  } as unknown as QueryRunner

  return { runner, calls, activeAtRelease }
}

/** 只暴露 createQueryRunner 的假 DataSource（本帮手只用到这一个方法） */
function fakeDataSource(runner: QueryRunner): Pick<DataSource, 'createQueryRunner'> {
  return { createQueryRunner: () => runner }
}

/** 假的 RLS 设置写入：与 `withWalnutRlsTransaction` 的 setup 同形 */
async function applyFakeSetup(manager: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await manager.query('SELECT set_config(...)')
}

describe('withQueryRunnerTransaction 生命周期（start / commit / rollback / release）', () => {
  beforeEach(() => {
    // 清理动作失败会 log.error —— 断言的是「记了日志」，不是日志内容
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('正常路径：setup 在事务里、commit 后 release 一次，回调拿到事务内 manager', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner()

    const result = await withQueryRunnerTransaction(
      fakeDataSource(runner),
      async manager => `ok:${String(manager !== undefined)}`,
      { setup: applyFakeSetup },
    )

    expect(result).toBe('ok:true')
    expect(calls).toEqual(['connect', 'start', 'set_config', 'commit', 'release'])
    // 还池判据：release 那一刻不能还有活跃事务
    expect(activeAtRelease).toEqual([false])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('readOnly：SET TRANSACTION READ ONLY 是事务里第一条语句（排在 setup 之前）', async () => {
    const { runner, calls } = createFakeRunner()

    await withQueryRunnerTransaction(fakeDataSource(runner), async () => 'ok', {
      readOnly: true,
      setup: applyFakeSetup,
    })

    expect(calls).toEqual([
      'connect',
      'start',
      'query:SET TRANSACTION READ ONLY',
      'set_config',
      'commit',
      'release',
    ])
  })

  it('回调抛错：先 rollback 再 release，原始错误透传，还池的连接不带事务', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner()

    await expect(withQueryRunnerTransaction(
      fakeDataSource(runner),
      async () => {
        throw new Error('handler boom')
      },
      { setup: applyFakeSetup },
    )).rejects.toThrow('handler boom')

    expect(activeAtRelease).toEqual([false])
    expect(calls).toEqual(['connect', 'start', 'set_config', 'rollback', 'release'])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('rollback 自身抛错：不掩盖原始错误，只记日志，release 仍然发生且只一次', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ rollbackThrows: true })
    const errorSpy = vi.spyOn(Logger.prototype, 'error')

    // 透传的必须是回调的错，不是 'pg rollback boom'
    await expect(withQueryRunnerTransaction(
      fakeDataSource(runner),
      async () => {
        throw new Error('handler boom')
      },
    )).rejects.toThrow('handler boom')

    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
    // rollback 的异常没有被吞掉不报：它进了日志（否则「连接回滚失败」永远不可见）
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // 这条用例钉住的是一个**做不到**的期望：ROLLBACK 语句自己失败时 runner 的
    // isTransactionActive 只能保持 true（标志在 TypeORM 手里，本帮手改不了）。
    // 能保证的是「仍然 release、原始错误仍然透传」—— 真实连接坏掉的场景里这条
    // 连接会被 pg-pool 直接丢弃（不进池），所以判据落在 release 与错误透传上。
    expect(activeAtRelease).toEqual([true])
  })

  it('setup 抛错（事务已开启）：同样 rollback → release，原始错误透传', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ setupThrows: true })

    await expect(withQueryRunnerTransaction(
      fakeDataSource(runner),
      async () => 'never',
      { setup: applyFakeSetup },
    )).rejects.toThrow('pg set_config boom')

    expect(activeAtRelease).toEqual([false])
    expect(calls).toEqual(['connect', 'start', 'set_config', 'rollback', 'release'])
  })

  it('startTransaction 抛错（1.1.2 已置 isTransactionActive）：不泄漏 —— rollback + release 各一次', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ startThrows: true })

    await expect(withQueryRunnerTransaction(fakeDataSource(runner), async () => 'never'))
      .rejects
      .toThrow('pg start boom')

    // 旧实现（connect/start 写在 try 之外）在这里既不 rollback 也不 release：连接带事务留在池里
    expect(calls).toEqual(['connect', 'start', 'rollback', 'release'])
    expect(activeAtRelease).toEqual([false])
    expect(calls.filter(c => c === 'release')).toHaveLength(1)
  })

  it('connect 抛错（事务从未开启）：不 rollback（1.1.2 会抛 TransactionNotStartedError），release 一次', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ connectThrows: true })

    await expect(withQueryRunnerTransaction(fakeDataSource(runner), async () => 'never'))
      .rejects
      .toThrow('pg connect boom')

    expect(calls).toEqual(['connect', 'release'])
    expect(activeAtRelease).toEqual([false])
  })

  it('commit 抛错：原始错误透传，仍补一条 rollback 清事务状态，release 一次', async () => {
    const { runner, calls, activeAtRelease } = createFakeRunner({ commitThrows: true })

    await expect(withQueryRunnerTransaction(fakeDataSource(runner), async () => 'ok'))
      .rejects
      .toThrow('pg commit boom')

    // commit 失败后事务状态未知，补 ROLLBACK 是安全的（服务端已回滚时 PG 只回 WARNING）
    expect(calls).toEqual(['connect', 'start', 'commit', 'rollback', 'release'])
    expect(activeAtRelease).toEqual([false])
  })

  it('release 抛错：结果照常返回，错误只记日志且不重试 release', async () => {
    const { runner, calls } = createFakeRunner({ releaseThrows: true })
    const errorSpy = vi.spyOn(Logger.prototype, 'error')

    await expect(withQueryRunnerTransaction(fakeDataSource(runner), async () => 'committed'))
      .resolves
      .toBe('committed')

    expect(calls).toEqual(['connect', 'start', 'commit', 'release'])
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('createQueryRunnerTxGuard 的幂等与守卫', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('release 幂等：重复调用只归还一次连接（重复 release 会抛 QueryRunnerAlreadyReleasedError）', async () => {
    const { runner, calls } = createFakeRunner()
    const tx = createQueryRunnerTxGuard(runner)

    await runner.startTransaction()
    await tx.commit()
    await tx.release()
    await tx.release()
    await tx.release()

    expect(calls.filter(c => c === 'release')).toHaveLength(1)
    expect(tx.released).toBe(true)
    expect(tx.committed).toBe(true)
  })

  it('commit 成功后 rollback 是 no-op（已提交的 runner 不能再回滚）', async () => {
    const { runner, calls } = createFakeRunner()
    const tx = createQueryRunnerTxGuard(runner)

    await runner.startTransaction()
    await tx.commit()
    await tx.rollback()

    expect(calls).toEqual(['start', 'commit'])
    expect(tx.committed).toBe(true)
  })

  it('事务从未开启时 rollback 是 no-op（1.1.2 的 rollbackTransaction 会抛，不是静默）', async () => {
    const { runner, calls } = createFakeRunner()
    const tx = createQueryRunnerTxGuard(runner)

    await tx.rollback()

    expect(calls).toEqual([])
  })

  it('commit 失败不置 committed（调用方必须能看见没提交成功）', async () => {
    const { runner } = createFakeRunner({ commitThrows: true })
    const tx = createQueryRunnerTxGuard(runner)

    await runner.startTransaction()
    await expect(tx.commit()).rejects.toThrow('pg commit boom')

    expect(tx.committed).toBe(false)
  })
})
