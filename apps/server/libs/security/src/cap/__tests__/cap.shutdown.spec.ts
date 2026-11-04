import { constants } from 'node:os'
import process from 'node:process'
import CapCtor from '@cap.js/server'
import { describe, expect, it, vi } from 'vitest'

import { createCapDetachedFromProcessHooks, WALNUT_ADMIN_CAP_PROCESS_EVENTS } from '../cap.shutdown'

/**
 * cap.js SIGTERM 竞争的**根因钉子**。
 *
 * cap.js 4.0.5 在构造期无条件注册 SIGTERM/SIGINT/SIGQUIT/beforeExit，并在 cleanup 后
 * `process.exit(0)`（node_modules/@cap.js/server/index.js:205-213）。它比 main.ts 的
 * `enableShutdownHooks()` 注册得早，于是部署时进程在 PG / Bull 排空之前就退出。
 *
 * 这里守住三件事：
 * 1. 摘下之后进程上不再留 cap 的监听器（根因消失）；
 * 2. 摘的**正是**会 `process.exit(0)` 的那个函数（负向对照：不摘就会退）；
 * 3. cap.js 升级若新增进程钩子，事件清单对不上 ⇒ 立刻红（不能只守住 4.0.5 的现状）。
 */

/** 进程上所有可能承载「信号钩子」的事件：Node 认识的信号 + beforeExit/exit */
const ALL_HOOK_EVENTS = [...Object.keys(constants.signals), 'beforeExit', 'exit']

function snapshot(): Record<string, ((...args: unknown[]) => unknown)[]> {
  return Object.fromEntries(
    ALL_HOOK_EVENTS.map(event => [event, process.listeners(event) as unknown as ((...args: unknown[]) => unknown)[]]),
  )
}

describe('cap.shutdown：把 cap.js 的进程钩子从 process 上摘下来', () => {
  it('摘掉的正是 cap 构造期注册的 4 个钩子，且进程上不留残留', () => {
    const before = snapshot()

    const detached = createCapDetachedFromProcessHooks(() => new CapCtor({ noFSState: true }))

    expect(detached.cap).toBeInstanceOf(CapCtor)
    expect(detached.hooks.map(hook => hook.event).sort()).toEqual([...WALNUT_ADMIN_CAP_PROCESS_EVENTS].sort())

    for (const hook of detached.hooks) {
      expect(process.listeners(hook.event)).not.toContain(hook.listener)
    }

    // 逐事件与构造前完全相同：既没多也没少（cap 的 4 个已摘掉，别人的原样在）
    expect(snapshot()).toEqual(before)
  })

  it('负向对照：被摘下的 SIGTERM 钩子若仍在进程上，cleanup 后会 process.exit(0)', async () => {
    const detached = createCapDetachedFromProcessHooks(() => new CapCtor({ noFSState: true }))
    const sigterm = detached.hooks.find(hook => hook.event === 'SIGTERM')

    expect(sigterm).toBeDefined()

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    // 直接调用被摘下来的监听器 = cap.js 自己在 SIGTERM 时做的事
    sigterm!.listener()

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0)
    })

    exitSpy.mockRestore()
  })

  it('不误伤调用方自己注册的监听器', () => {
    const sentinel = (): void => {}
    process.on('SIGTERM', sentinel)

    createCapDetachedFromProcessHooks(() => new CapCtor({ noFSState: true }))

    expect(process.listeners('SIGTERM')).toContain(sentinel)

    process.removeListener('SIGTERM', sentinel)
  })

  it('漂移守卫：裸 new Cap() 只在这 4 个事件上新增监听器（cap.js 升级新增钩子会让这条红）', () => {
    const before = snapshot()

    const cap = new CapCtor({ noFSState: true })

    const added = ALL_HOOK_EVENTS.filter(event => process.listeners(event).length > before[event].length)

    expect(added.sort()).toEqual([...WALNUT_ADMIN_CAP_PROCESS_EVENTS].sort())

    // 清场：别把裸 cap 的钩子漏给同进程的后续用例
    for (const event of ALL_HOOK_EVENTS) {
      for (const listener of process.listeners(event)) {
        if (!before[event].includes(listener)) {
          process.removeListener(event, listener)
        }
      }
    }

    expect(cap).toBeInstanceOf(CapCtor)
  })
})
