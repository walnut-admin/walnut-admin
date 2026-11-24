/**
 * 进命令行的 git ref 白名单 —— 纯逻辑，release 流程用它挡「被污染的 ref（分支名 / tag 名）」。
 *
 * 为什么必须有它：ref 会作为 **argv** 传给 `git push origin <分支> <标签>` 这类命令，而 git 自己允许
 * ref 名含 `$ ( ) { } > "`（`git check-ref-format` 放行），`..` 又能做路径上跳。两道防线各管一段：
 * ① 本模块的白名单挡掉离谱输入并给出人话报错；② 调用方一律 argv 直传（见 lib/git.ts、
 * lib/child-run.ts 的 `shell: false`），即便校验被绕过也进不了 shell。
 * 失败口径：抛 `PreconditionError`（→ 退出码 2：输入没准备好，不是检出违规）。
 * 不做什么：不自己退进程、不拼命令行（只返回 / 抛出，纯函数可被单测逐条覆盖）。
 */

import { PreconditionError } from './errors.ts'

/** git 明令禁止出现在 ref 名里的字符（`[` 与 `\` 一并挡掉：本仓写不出这种 ref，argv 里也没有正当用途） */
const ILLEGAL_CHARS = ['~', '^', ':', '?', '*', '[', '\\'] as const

/** 控制字符（含 DEL）：不用正则字面量表达，避开 `no-control-regex` */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7F)
      return true
  }
  return false
}

/** 返回拒绝**理由**；合法返回 null（判据只有这一处，便于测试逐条覆盖） */
function refProblem(value: string): string | null {
  if (value === '')
    return '它是空串'
  if (value.startsWith('-'))
    return '它以 `-` 开头，会被 git 当成选项解析'
  if (/\s/.test(value))
    return '它含空白字符'
  if (hasControlChar(value))
    return '它含控制字符'
  if (value.includes('..'))
    return '它含 `..`，可能是路径上跳或区间写法'
  const illegal = ILLEGAL_CHARS.find(char => value.includes(char))
  if (illegal !== undefined)
    return `它含 git 保留字符 \`${illegal}\``
  if (value.includes('@{'))
    return '它含 `@{`（git 的 reflog / upstream 语法）'
  if (value.includes('//'))
    return '它含 `//`（空路径段）'
  if (value.endsWith('.') || value.endsWith('.lock'))
    return '它以 `.` 或 `.lock` 结尾（git 保留）'
  return null
}

/**
 * 断言一个值可以安全地当作 git ref 使用，成功原样返回。
 *
 * `what` 只进报错文案（`分支名` / `tag 名` / `提交区间`），本层不认识任何业务。
 */
export function assertSafeRef(value: string, what: string): string {
  const problem = refProblem(value)
  if (problem) {
    throw new PreconditionError(
      `${what}不能作为 git 参数：${problem}\n`
      + `   值：${JSON.stringify(value)}\n`
      + `   为什么：ref 会作为 argv 传给 \`git push origin <分支> <标签>\` 这类命令，`
      + `选项形态（\`--force\`）或路径上跳（\`a/../b\`）的字符串绝不能到那里。`,
    )
  }
  return value
}
