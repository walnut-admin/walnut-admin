/**
 * 子进程**树的收尾**：登记当前活跃子进程，并在超时 / 中止时把整棵树收掉。
 *
 * 为什么单独成模块：这是「终端说已中止、后台还在改盘」的唯一防线 —— 子进程被放到独立进程组 /
 * 独立进程树（这样超时时能连 `sh -c` 的孙进程一起收掉），代价是终端的 SIGINT **送不到它**；
 * 父进程一退，它就变成孤儿继续写盘。**「父进程说停手了、子进程仍在写工作区」正是要防的失败形态**：
 * 发版脚本打出「本次已中止」之后，`pnpm version -r` 若还在改 manifest，用户看到的是干净的终端、
 * 实际拿到的是半升级的工作区。平台机制还不同（win32 只有 `taskkill /T /F` 管用：实测
 * `process.kill(-pid)` 抛 ESRCH），故单列一层。
 * 失败口径：`killActiveChild` 返回「是否**确认**走了树杀」—— false 表示只杀到直接子进程
 * （孙进程可能还活着），调用方必须据此**拒绝重试**（两条命令同时写盘是最不该出现的形态）。
 * 不做什么：不解释失败含义、不打印、不决定退出码。
 */

import type { ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

/** 超时 / 中止后先 TERM 再 KILL 的宽限期：给它机会自己收尾，但不允许它无限拖住发版 */
export const KILL_GRACE_MS = 10_000

interface ActiveChild {
  exited: Promise<void>
  resolveExit: () => void
}

/**
 * 当前活跃的子进程（模块级）。
 *
 * ⚠️ 是**集合**不是单槽：早先只记最后一个时，「两个子进程同时在跑」的 `killActiveChild()` 返回值
 * 只反映最后一个 ⇒ 那是个**假确认**（另一个还在写盘，调用方却以为收干净了）。
 */
const active = new Map<ChildProcess, ActiveChild>()

/** 登记一个子进程（重复登记无副作用；`unregisterChild` 负责清账） */
export function registerChild(child: ChildProcess): void {
  if (active.has(child))
    return
  let resolveExit: () => void = () => {}
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  active.set(child, { exited, resolveExit })
}

/** 子进程结束时清账（child-run 在 `close` / `error` 两条路径上都调它，`waitForActiveChildExit` 靠它解开） */
export function unregisterChild(child: ChildProcess): void {
  const entry = active.get(child)
  if (!entry)
    return
  active.delete(child)
  entry.resolveExit()
}

/** 杀一个进程；杀不到说明它已经自己退出了（正常收尾路径），不是异常 —— 故返回布尔而不是抛 */
function tryKill(child: ChildProcess, signal: NodeJS.Signals): boolean {
  try {
    child.kill(signal)
    return true
  }
  catch {
    return false
  }
}

/** 这个子进程是不是还活着（`exitCode` / `signalCode` 一旦有值就说明已经结束） */
function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/**
 * 收掉一个子进程（树）。返回是否**确认**走了树杀：
 * `false` 表示只杀到了直接子进程（`sh -c` / cmd.exe 的孙进程可能还活着）⇒ 调用方必须拒绝重试。
 *
 * 平台机制：
 * - win32：`taskkill /PID <pid> /T /F`（argv 直传、`stdio: 'ignore'`；`process.kill(-pid)` 在 Windows 上抛 ESRCH）
 * - 其它：负 pid 杀**进程组**（由 spawn 的 `detached: true` 建立），宽限期后升级 SIGKILL
 */
function terminateTree(child: ChildProcess, platform: NodeJS.Platform): boolean {
  if (child.pid === undefined || !isAlive(child))
    return true
  const pid = child.pid
  if (platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: KILL_GRACE_MS })
      return true
    }
    catch {
      // taskkill 不在 / 权限不足：退回单杀，并如实告诉调用方「树没确认收掉」
      tryKill(child, 'SIGKILL')
      return false
    }
  }
  let groupKilled = true
  try {
    process.kill(-pid, 'SIGTERM')
  }
  catch {
    // 没有进程组可杀（子进程不是组长）：退回单进程
    groupKilled = tryKill(child, 'SIGTERM')
  }
  // SIGKILL 升级：SIGTERM 之后若它还在，宽限期到点强杀。**只在它还活着时**升级 ——
  // 直接子进程已退出后 pid 可能被系统复用，此时对 `-pid` 补刀会误伤一个无关的进程组。
  const escalate = setTimeout(() => {
    if (!isAlive(child))
      return
    try {
      process.kill(-pid, 'SIGKILL')
    }
    catch {
      tryKill(child, 'SIGKILL')
    }
  }, KILL_GRACE_MS)
  escalate.unref()
  return groupKilled
}

/**
 * 中止路径用：收掉**全部**活跃子进程，返回「是否每一个都确认走了树杀」。
 *
 * 返回 `false` 的语义：至少有一个只杀到直接子进程（孙进程可能还活着）⇒ 调用方拒绝重试。
 * 没有任何活跃子进程时返回 `true`（收干净了）。
 */
export function killActiveChild(platform: NodeJS.Platform = process.platform): boolean {
  let allConfirmed = true
  for (const child of [...active.keys()]) {
    if (!terminateTree(child, platform))
      allConfirmed = false
  }
  return allConfirmed
}

/** 等**全部**活跃子进程退出；超时返回 `false`（没有任何活跃子进程时返回 `true`） */
export async function waitForActiveChildExit(ms: number): Promise<boolean> {
  if (active.size === 0)
    return true
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    // 刻意**不** unref：调用方要的就是「真的等到退出 / 到点」（unref 的计时器在没有其它 ref 句柄时
    // 会让 Node 直接退出，于是这个 wait 静默变成「没等」）；但不能在子进程已退出后还占着事件循环，
    // 所以 race 一结束就 clearTimeout。
    timer = setTimeout(resolve, ms, false)
  })
  const all = Promise.all([...active.values()].map(entry => entry.exited)).then(() => true)
  try {
    return await Promise.race([all, timeout])
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}
