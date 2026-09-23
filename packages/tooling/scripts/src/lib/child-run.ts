/**
 * 子进程的执行面：实况输出、心跳、有界预算、结构化失败、进程树收尾。
 *
 * 为什么需要：发版的三条不可逆动作（`pnpm version -r` / `git commit` / `git push`）都是子进程，而
 * 「卡住」与「死锁」在终端上无法区分、「失败了」与「没跑起来」的下一步动作完全不同；更关键的是
 * Ctrl+C 后退出的**只是父进程** —— 子进程树若还活着，它仍在改 manifest，而脚本已经打印了「本次已中止」
 * （见 lib/child-tree.ts）。用 `stdio: 'inherit'` 又会把失败正文丢掉（见 lib/child-output.ts）。
 *
 * **ARGV ONLY**：命令行只用于**打印**，执行走 `spawn(cmd, args)` + `shell: false` —— 分支名 / tag 名
 * 会进 argv，而 git 允许 ref 名含 `"`；直传后即便校验被绕过也进不了 shell。
 * 失败口径：非零退出 / 超时 / 被信号结束 / 根本没跑起来都抛 `ChildRunError`（带 `exitCode`），
 * 退出码由 CLI 决定怎么用。
 * 不做什么：不装信号钩子、不 `process.exit`、不决定「失败该怎么办」（那些是 CLI 的策略）。
 */

import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { renderFailureTail, TailBuffer } from './child-output.ts'
import { killActiveChild, registerChild, unregisterChild } from './child-tree.ts'
import { writeOut } from './log.ts'

/** 长命令的兜底预算：15 分钟（git push 的预推送门禁 + 网络；宁可给宽，不可不设） */
const DEFAULT_BUDGET_MS = 15 * 60_000
/** 心跳间隔：让「还在跑」与「卡死了」在终端上可区分 */
const DEFAULT_HEARTBEAT_MS = 5_000
/** 预算的环境变量名（调用方可用 `budgetEnv` 换成自己的业务口径名） */
const DEFAULT_BUDGET_ENV = 'CMD_TIMEOUT_MS'
/** 超时后那段归因文案（调用方可用 `timeoutHint` 按场景覆盖） */
const DEFAULT_TIMEOUT_HINT = '   命令超过预算已被中止。先确认它没卡在交互提示上，再排查环境（网络 / 磁盘 / 依赖）：'
  + '卡住不等于失败，重跑通常能接上。'

/** 子进程输出的去向（模块内部的名字；对外只出现匿名结构，`--json` 时传 `streamOutput(true)` 全改道 stderr） */
interface Sink {
  write: (text: string) => void
}

export interface RunVisibleOptions {
  /** 探针行的出口（CLI 的 `log()`）；心跳与子进程输出走 `output`；缺省写 stderr */
  note?: (msg: string) => void
  /** 子进程 stdout / stderr 的去向；缺省 stdout → `process.stdout`、stderr → `process.stderr` */
  output?: { write: (text: string) => void }
  /**
   * 子进程的**完整**环境（缺省 `process.env`）。要剥凭据请传 `sanitizeEnv([...])` 的结果 ——
   * 本模块不替调用方决定哪些变量是凭据。
   */
  env?: NodeJS.ProcessEnv
  /**
   * 子进程的工作目录（缺省继承调用方）。**跨包的编排一律显式给仓库根**：从子目录跑时，
   * `pnpm <脚本>` 会解析到**最近那个包**的脚本（于是「根 test」静默缩成单包 test）。
   */
  cwd?: string
  /** 跑之前先解释「这一步在干什么、可能等多久」——把静默等待变成有预期的等待 */
  hint?: string
  /** 超时后那段归因文案（缺省给通用说明；调用方按自己的场景给，门禁超时与网络无关） */
  timeoutHint?: string
  /** 覆盖预算的**环境变量名**（缺省 `CMD_TIMEOUT_MS`）；名字由调用方给，本层不认识业务口径 */
  budgetEnv?: string
  /** 环境变量没给 / 给得不合法时的预算兜底（毫秒；`<= 0` = 不设上限） */
  budgetDefaultMs?: number
  /** 心跳间隔（毫秒；`<= 0` = 不打心跳） */
  heartbeatMs?: number
}

export class ChildRunError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'ChildRunError'
    this.exitCode = exitCode
  }
}

/**
 * 克隆一份环境并**摘掉**指定的变量名。
 *
 * 为什么必须剥：`git push` 会触发本仓自己的 pre-push 钩子（`pnpm --silent prepush`），那里面跑的全是
 * 仓库里的脚本，而钩子内容可以被一次提交改掉 —— 于是「有合并权限的人」被放大成「有发版机凭据的人」。
 * 用 `--no-verify` 绕过是**错的**（那等于把本地门禁整个拆掉），剥掉才是正解。
 * `GIT_TERMINAL_PROMPT=0` 同时强制：凭据缺失时 git 必须失败，而不是挂在交互提示上（在 CI 里表现为卡死）。
 */
export function sanitizeEnv(strip: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const name of strip)
    delete env[name]
  return env
}

/** 本进程的 stdout / stderr 出口（TTY 与管道各走各的正确路径，见 lib/log.ts） */
export function streamOutput(toStderr: boolean): { write: (text: string) => void } {
  return { write: text => writeOut(text, toStderr) }
}

/** 缺省探针出口：人类进展一律走 stderr，stdout 留给机器可读结果 */
function defaultNote(msg: string): void {
  writeOut(`${msg}\n`, true)
}

/** 预算：先看 `budgetEnv` 指名的环境变量，再退回 `budgetDefaultMs`，最后 15 分钟；`<= 0` = 不设上限 */
function budgetMsOf(options: RunVisibleOptions): number {
  const fromEnv = Number(process.env[options.budgetEnv ?? DEFAULT_BUDGET_ENV])
  if (Number.isFinite(fromEnv) && fromEnv > 0)
    return fromEnv
  const fallback = options.budgetDefaultMs ?? DEFAULT_BUDGET_MS
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
}

/** 退出原因的人话（`code === null` = 被信号结束，如 OOM 的 SIGKILL / 外部 kill） */
function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `被信号 ${signal ?? '?'} 结束` : `退出码 ${code}`
}

/** 逐块转播子进程输出（实时性不变），同时把尾部留进 `tail` 供失败时重播 */
function relay(stream: Readable | null, sink: Sink, tail: TailBuffer): void {
  stream?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    sink.write(text)
    tail.push(text)
  })
}

/**
 * 实况执行一条命令（长命令：先打印再跑，跑完报用时）。**argv 直传，永不 shell**。
 *
 * 用异步 `spawn` 而不是 `execSync`：`execSync` 阻塞事件循环，心跳计时器永远轮不到
 * （这正是「卡住时终端一个字都没有」的成因）。异步之后 event loop 保持自由，于是：
 * ① 每 `heartbeatMs` 打一个心跳，人一眼能看出「还在跑」；② 到点能真的超时并杀掉子进程树；
 * ③ Ctrl+C 的 SIGINT 回调能立刻生效（不再被同步调用推迟）。
 */
export async function runArgs(cmd: string, args: string[], opts: RunVisibleOptions = {}): Promise<{ code: number }> {
  const display = [cmd, ...args].join(' ')
  const note = opts.note ?? defaultNote
  const startedAt = Date.now()
  const budgetMs = budgetMsOf(opts)
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const tail = new TailBuffer()
  const stdoutSink = opts.output ?? streamOutput(false)
  const stderrSink = opts.output ?? streamOutput(true)

  note(`$ ${display}`)
  if (opts.hint)
    note(`   ${opts.hint}`)

  let child: ChildProcess
  try {
    child = spawn(cmd, args, {
      // stdin 仍继承（`pnpm version -r` 可能起交互提示）；stdout/stderr 走管道以便「转播 + 留尾」
      stdio: ['inherit', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      // 显式写出：命令行只用于打印，执行永远走 argv（不经 shell 解析 `&` / `|` / `%VAR%`）
      shell: false,
      // 平台分支：两个选项在 Windows 上都不是「无害的默认值」。
      //   · `detached`：POSIX 必须开 —— child-tree 靠负 pid 杀进程组；**Windows 必须关** —— 它会给
      //     子进程分配独立控制台（Node 文档：The child will have its own console window），而本仓的
      //     stdio 是管道、又常在无控制台的宿主里起，于是启动期会以 ERROR_NO_DATA 报错并弹窗。
      //     Windows 的树杀走 `taskkill /T`，按父子关系收，不需要 detached。
      //   · `windowsHide`：Windows 上再显式请求隐藏初始窗口。
      detached: process.platform !== 'win32',
      windowsHide: process.platform === 'win32',
    })
  }
  catch (error) {
    // spawn 自身同步抛（cwd 不存在 / 参数非法）：这不是「子进程报了违规」，而是**根本没跑起来**
    throw new ChildRunError(`启动失败（没跑起来）：${display} —— ${error instanceof Error ? error.message : String(error)}`, 2)
  }

  // 登记进 child-tree：「它何时真的没了」由那边统一持有 —— 中断路径要**等**它再打印「已中止」
  // （否则终端说停手了、后台还在写盘）
  registerChild(child)
  relay(child.stdout, stdoutSink, tail)
  relay(child.stderr, stderrSink, tail)

  let timedOut = false
  let heartbeat: NodeJS.Timeout | undefined
  let deadline: NodeJS.Timeout | undefined
  try {
    const code = await new Promise<number>((resolve, reject) => {
      if (heartbeatMs > 0) {
        // 心跳只报告事实（已跑多久 + 预算），不猜原因
        heartbeat = setInterval(() => {
          const ran = Math.round((Date.now() - startedAt) / 1000)
          note(`   … 仍在执行 ${ran}s${budgetMs > 0 ? `（上限 ${Math.round(budgetMs / 1000)}s）` : ''}`)
        }, heartbeatMs)
      }
      if (budgetMs > 0) {
        // 超时：收掉进程树（先 TERM，宽限期后由 child-tree 升级 KILL）
        deadline = setTimeout(() => {
          timedOut = true
          note(`❌ 超过 ${Math.round(budgetMs / 1000)}s 上限，结束它（可用 ${opts.budgetEnv ?? DEFAULT_BUDGET_ENV} 调整）`)
          killActiveChild()
        }, budgetMs)
      }
      child.once('error', (error: Error) => {
        unregisterChild(child)
        reject(new ChildRunError(`启动失败（没跑起来）：${display} —— ${error.message}`, 2))
      })
      child.once('close', (exitCode, signal) => {
        unregisterChild(child)
        if (timedOut) {
          reject(new ChildRunError(
            `超时（>${Math.round(budgetMs / 1000)}s）：${display}\n${renderFailureTail(tail.lines())}\n${opts.timeoutHint ?? DEFAULT_TIMEOUT_HINT}`,
            2,
          ))
          return
        }
        if (exitCode === 0) {
          resolve(0)
          return
        }
        // 把退出码挂在错误上：调用方要按三态（1 违规 / 2 前置未满足）区分时，不能只看到「失败了」。
        // `exitCode === null` = 被信号结束（如 OOM 的 SIGKILL）：同样没得出判定，归 2。
        reject(new ChildRunError(
          `${display} 失败：${describeExit(exitCode, signal)}\n${renderFailureTail(tail.lines())}`,
          exitCode ?? 2,
        ))
      })
    })
    return { code }
  }
  finally {
    if (heartbeat)
      clearInterval(heartbeat)
    if (deadline)
      clearTimeout(deadline)
    note(`   ↳ 用时 ${Date.now() - startedAt}ms`)
  }
}

/**
 * 短命令的同步版：`spawnSync` 包一层，返回 `{ code, stdout, stderr }` **而不是抛**。
 *
 * 为什么它存在：短查询（`git rev-parse` 一类）用异步 + 心跳那套太重，而调用方要的只是「成没成 +
 * 说了什么」。仍然 argv 直传、仍然 `shell: false`。
 */
export function runSync(
  cmd: string,
  args: string[],
  opts: { cwd?: string, env?: NodeJS.ProcessEnv } = {},
): { code: number, stdout: string, stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    windowsHide: process.platform === 'win32',
  })
  return {
    // spawn 失败时 `status` 是 null（错误在 `error` 里）—— 那种情况绝不能被读成 0
    code: result.status ?? 1,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? result.error?.message ?? '',
  }
}
