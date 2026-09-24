/**
 * 人类输出的**唯一出口**：口径只有一条 —— TTY 走 `stream.write`，管道走 `fs.writeSync`。
 *
 * 为什么 TTY **不能**用 `fs.writeSync`（2026-09 真实回归）：Windows 上 `process.stdout` 对 TTY 走
 * `WriteConsoleW`（宽字符，控制台按 Unicode 显示）；而 `fs.writeSync(1, text)` 往文件描述符写的是
 * **UTF-8 字节**，控制台按当前代码页（简体中文 Windows 是 CP936）解释 ⇒ 中文全成乱码。
 * 为什么管道**不能**用 `stream.write`：指向**管道**的 stdout 是异步的，紧跟其后的 `process.exit()`
 * 会把还没冲刷的缓冲丢掉 —— 实测 `… | cat` 这类非 TTY 调用里退出码是对的、**拒绝理由一个字都没出来**。
 * 管道按字节读、不经代码页，故 `fs.writeSync` 在那里既正确（UTF-8）又是同步的；TTY 的写入本来就是
 * 同步的，没有丢缓冲的问题 —— 所以两边各用各的正确路径。
 * 失败口径：写不出去（EPIPE / 句柄失效，如 `| head` 提前收工）属**预期中断**，吞掉；其余写错误
 * （磁盘满、句柄被系统回收）照抛 —— 否则我们会静默丢掉整条日志。
 * 不做什么：不决定退出码与文案、不做排版（横幅由 `frame` 构造）。
 */

import fs from 'node:fs'
import process from 'node:process'

/** 只吞这几类：父进程提前收工（`| head`）与句柄失效 */
const SWALLOWED_WRITE_ERRORS = new Set(['EPIPE', 'EBADF', 'ERR_STREAM_DESTROYED', 'ESTALE'])

/** 横幅边框宽度：确定值（无颜色码、无终端探测），因此测试可以逐字节断言 */
const RULE = '─'.repeat(62)

export function writeOut(text: string, toStdErr: boolean): void {
  const stream = toStdErr ? process.stderr : process.stdout
  try {
    if (stream.isTTY) {
      stream.write(text)
      return
    }
    fs.writeSync(toStdErr ? 2 : 1, text)
  }
  catch (error) {
    const code = (error as { code?: unknown }).code
    if (typeof code !== 'string' || !SWALLOWED_WRITE_ERRORS.has(code))
      throw error
  }
}

/**
 * 横幅（总览 / 状态 / 确认用）：上下各一条边框，正文原样居中不了、也不缩进 —— 缩进是各调用点
 * 的排版选择，本函数只负责「框起来」。返回值以换行结尾，可直接交给 `writeOut`。
 */
export function frame(lines: string[]): string {
  return `${RULE}\n${lines.join('\n')}\n${RULE}\n`
}

/**
 * 结论标记的**唯一词表**（门禁与 CLI 输出文案的最小口径）。
 *
 * 为什么只有这四个：这些程序的输出都是「一行一个结论」，而这四类结论的**下一步动作完全不同** ——
 * **通过**（什么都不用做）、**违规**（改代码）、**提示**（知道就行：降级、跳过、未核实）、
 * **跳过**（这一步按设计没跑）。多一个标记就等于多一个要解释的语义。
 *
 * ⚠️ **`prepush` 的对齐表格是刻意的例外**：那里用 `✓` / `✗` 而不是 `✅` / `✖` ——
 * 表格靠 `padStart` 对齐，而 emoji 是**双宽**字符，混进去整列会歪。例外只有这一处。
 */
export const MARK = {
  ok: '✅',
  violation: '✖',
  warning: '⚠',
  skipped: '⏭️',
} as const

export type MarkKind = keyof typeof MARK

/** 一行结论 → **stdout**（通过 / 进度这类"正常叙述"） */
export function line(kind: MarkKind, text: string): void {
  writeOut(`${MARK[kind]} ${text}\n`, false)
}

/** 一行结论 → **stderr**（违规明细 / 诊断这类"出事了才看"的内容） */
export function lineErr(kind: MarkKind, text: string): void {
  writeOut(`${MARK[kind]} ${text}\n`, true)
}

/**
 * 无标记的**上下文字**（"这次扫了多少东西"这类叙述）→ stdout。
 *
 * 为什么单独给一个函数：判据行一律带标记，而上下文行**不该**抢标记 ——
 * 读者扫一眼标记就知道结论，标记一泛滥就失去意义。
 */
export function out(text: string): void {
  writeOut(text.endsWith('\n') ? text : `${text}\n`, false)
}

/** 无标记的**说明 / 修法** → stderr（跟着详细发现一起出现） */
export function err(text: string): void {
  writeOut(text.endsWith('\n') ? text : `${text}\n`, true)
}
