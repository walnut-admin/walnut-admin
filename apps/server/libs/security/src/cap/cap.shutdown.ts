import type Cap from '@cap.js/server'
import process from 'node:process'

/**
 * cap.js v4 把「进程收尾」写死在**构造期**，而且没有开关。
 *
 * `node_modules/@cap.js/server/index.js:205-213`（4.0.5）：
 *
 * ```js
 * process.on('beforeExit', () => this.cleanup())
 * ;['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
 *   process.once(signal, () => {
 *     this.cleanup().then(() => process.exit(0)).catch(() => process.exit(1))
 *   })
 * })
 * ```
 *
 * - `cleanup()`（index.js:545-565）只做两件事：清过期 token（`_cleanExpiredTokens`）
 *   + 把 `config.state.tokensList` 写回 `tokens_store_path`（本项目是本地文件）。
 * - **不可关闭**：`disableAutoCleanup` 只影响 `_lazyCleanup()`（index.js:221-233），
 *   `noFSState` / `storage` 只影响落盘；信号注册是无条件的。
 *
 * 因为 `AppCapJS` 在**模块求值期**就 new 出来（cap.service.ts），这组监听器比
 * `app.enableShutdownHooks()`（main.ts）注册得**更早**。SIGTERM 一到，cap 先跑完
 * cleanup 就 `process.exit(0)` —— Nest 的关闭序列（Redis quit → cap 落盘 → 停监听
 * → PG / Bull 排空）被从中间截断。实测见 reports/batch-7/r2-sigterm.md §3：
 *
 * ```text
 *  17825ms emit SIGTERM
 *  17832ms cap.cleanup start
 *  17852ms cap.cleanup done
 *  17852ms process.exit(0)   ← @cap.js/server/index.js:210
 *  17873ms 'exit' event code=0        （pg.DataSource.destroy / Bull close 从未发生）
 * ```
 *
 * 本模块把这组监听器**摘下来**（不改 node_modules、不 fork）：在 `create()` 前后对
 * 进程监听器做差集，摘掉的正是构造器刚刚注册的那几个 —— 既不需要知道 cap 内部的函数
 * 引用，也不会误伤调用方自己注册的监听器。cleanup 本身改由 Nest 的关闭钩子显式调用
 * （cap.service.ts 的 `beforeApplicationShutdown`），语义不变、顺序正确。
 */

/** cap.js 4.0.5 构造期会注册的进程事件（index.js:205-213）；升级 cap.js 时先看这里 */
export const WALNUT_ADMIN_CAP_PROCESS_EVENTS = [
  'beforeExit',
  'SIGINT',
  'SIGTERM',
  'SIGQUIT',
] as const

export type WalnutAdminCapProcessEvent = (typeof WALNUT_ADMIN_CAP_PROCESS_EVENTS)[number]

export type WalnutAdminCapProcessListener = (...args: unknown[]) => unknown

/** 一个被摘下来的 cap.js 进程监听器 */
export interface IWalnutAdminCapDetachedHook {
  readonly event: WalnutAdminCapProcessEvent
  readonly listener: WalnutAdminCapProcessListener
}

export interface IWalnutAdminCapDetached {
  readonly cap: Cap
  readonly hooks: readonly IWalnutAdminCapDetachedHook[]
}

function listenersOf(event: WalnutAdminCapProcessEvent): WalnutAdminCapProcessListener[] {
  return process.listeners(event) as unknown as WalnutAdminCapProcessListener[]
}

/**
 * 用 `create()` 造 cap 实例，并把构造期抢注册的进程监听器全部摘下。
 *
 * 返回的 `hooks` 只用于排查与单测（生产路径不应再调用它们）；`cap` 与直接
 * `new Cap(...)` 完全等价，唯一的区别是进程上不再有它的监听器。
 *
 * @param create 真正 `new Cap(...)` 的工厂（本函数不关心 cap 的配置）
 */
export function createCapDetachedFromProcessHooks(create: () => Cap): IWalnutAdminCapDetached {
  // 快照：只摘「create() 期间新增」的监听器，调用方自己的监听器原样保留
  const before = new Map<WalnutAdminCapProcessEvent, ReadonlySet<WalnutAdminCapProcessListener>>(
    WALNUT_ADMIN_CAP_PROCESS_EVENTS.map(event => [event, new Set(listenersOf(event))] as const),
  )

  const cap = create()

  const hooks: IWalnutAdminCapDetachedHook[] = []
  for (const event of WALNUT_ADMIN_CAP_PROCESS_EVENTS) {
    const known = before.get(event) ?? new Set<WalnutAdminCapProcessListener>()
    for (const listener of listenersOf(event)) {
      if (known.has(listener)) {
        continue
      }
      // process.once 在内部包了一层 wrapper，但 listeners() 返回的已经是原函数，
      // removeListener 也接受原函数（Node 按 wrapper.listener 比对），所以够用
      process.removeListener(event, listener)
      hooks.push({ event, listener })
    }
  }

  return { cap, hooks }
}
