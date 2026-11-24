/**
 * pnpm 启动器：Windows 上**唯一**能安全传任意参数的方式。
 *
 * 为什么不能换别的方式起 pnpm：任何 `child_process` 调用想在 Windows 上拿到「argv 原样」就不能经
 * cmd.exe。实测三条都会变形：① `execFileSync('pnpm', args)` → ENOENT（PATH 上是 `pnpm.cmd`，
 * Node 24 不再当可执行文件解析）；② `{ shell: true }` → Node 只拼接不转义（DEP0190），`&` 直接执行、
 * `|` 直接变管道；③ 经 ComSpec 拼行 → cmd 重新解析，`%GITEE_TOKEN%` 被展开、参数边界消失。
 * **绝不退回 `shell: true`**：静默变形等于把 commit 标题里的 `%VAR%` 展开成凭据再写进 CHANGELOG / push。
 *
 * `pnpm.cmd` 自己在做 `"%dp0%\node_modules\pnpm\pnpm.exe" %*`，所以这里直接找那个真 exe 来 spawn
 * （走 CreateProcess，`%`/`&`/`|`/`^` 一律是普通字符）。
 * 失败口径：找不到就抛 `PreconditionError`（→ 退出码 2）并给出修法，不猜、不回退 shell。
 * 不做什么：不决定跑哪些子命令（argv 由调用方给）、不打印、不缓存（找不到的机器不该被上一次的结果糊住）。
 */

import { statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { PreconditionError } from './errors.ts'

/** 需要 node 作宿主的 JS 入口（`pnpm.cjs` / `pnpm.mjs`）：直接 spawn 会 ENOENT / EACCES，不能当可执行文件 */
const JS_ENTRY = /\.(?:c|m)?js$/i

/** Windows 上不经 cmd.exe 就能起的扩展名（`.cmd` / `.bat` 必须经 cmd.exe，被本模块明令排除） */
const WIN_EXECUTABLE = /\.(?:exe|com)$/i

/** 这个路径能不能被 `spawn(bin, args)` 直接起（argv 原样、不经 shell） */
function isRunnable(path: string): boolean {
  try {
    if (!statSync(path).isFile())
      return false
  }
  catch {
    return false
  }
  if (JS_ENTRY.test(path))
    return false
  return process.platform !== 'win32' || WIN_EXECUTABLE.test(path)
}

/**
 * 候选路径，按可信度排序：① 包管理器自报的入口（由 pnpm 自己启动时一定有）；
 * ② node 安装目录下的全局布局；③ PATH 上每个目录的同一套布局。
 */
function pnpmCandidates(): string[] {
  const found: string[] = []
  const fromEnv = process.env.npm_execpath
  if (fromEnv)
    found.push(fromEnv)
  const dirs = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter).filter(Boolean)]
  for (const dir of dirs) {
    if (process.platform === 'win32') {
      // `pnpm.cmd` 与 node.exe 同目录时，真 exe 在其 node_modules 下；两种布局都试
      found.push(join(dir, 'node_modules', 'pnpm', 'pnpm.exe'))
      found.push(join(dir, 'pnpm.exe'))
    }
    else {
      found.push(join(dir, 'pnpm'))
    }
  }
  return found
}

/** 找到真正的 pnpm 可执行文件（绝对路径）；找不到抛 `PreconditionError` 并给出修法 */
export function getPnpmBin(): string {
  const candidates = pnpmCandidates()
  const found = candidates.find(isRunnable)
  if (found)
    return resolve(found)
  throw new PreconditionError(
    '找不到 pnpm 的可执行文件（拒绝退回 `shell: true`：cmd.exe 会展开参数里的 `%VAR%`，'
    + '凭据 / 任意环境变量都可能因此进子进程命令行）。\n'
    + `   已找过：\n${candidates.map(c => `     · ${c}`).join('\n')}\n`
    + '   修法：用 pnpm 启动本脚本（会带上 `npm_execpath`），或把全局 pnpm 装回 node 安装目录'
    + '（Windows：`npm i -g pnpm` 后确认 `node_modules/pnpm/pnpm.exe` 存在），'
    + '或用 `corepack enable pnpm` 让 `node` 旁边重新出现 pnpm。',
  )
}
