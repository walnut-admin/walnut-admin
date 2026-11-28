/**
 * `clean:all` 的执行面：把 `lib/clean-all.ts` 的「删」接上输出与退出码。
 *
 * ## 为什么在入口进程里删，而不是 `pnpm exec rimraf …`
 *
 * rimraf 自己就住在根 `node_modules` 里。经 pnpm 起它、再让它把根 `node_modules` 删掉，等于让它拆自己
 * 脚下的地板：Windows 上目录确实删干净了，但 `pnpm exec` 这层包装随后收尾失败，命令以退出码 1 结束
 * （2026-11-23 在仓库外的空包里复现）。入口进程的代码住在仓库源码目录里，运行期只依赖 `node:*` 内置模块，
 * 结构上不存在这个问题 —— 详见 `lib/clean-all.ts` 的头注释。
 *
 * ## 三种结局
 *
 * | 情形 | 怎么收场 |
 * |---|---|
 * | 已经是干净的（一个目标都不存在） | 打一行结论，正常返回 |
 * | 全部删掉 | 打印删了哪些，正常返回，并提醒重新 `pnpm install` |
 * | 有删不掉的 | 逐个报出路径与原因，抛违规错误（退出码 1）—— 没清干净不许以 0 收场 |
 */

import fs from 'node:fs'
import path from 'node:path'
import { cleanAll, listCleanAllTargets } from '../lib/clean-all.ts'
import { ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

export async function runCleanAll(): Promise<void> {
  const targets = listCleanAllTargets(REPO_ROOT)
  const present = targets.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)))

  if (present.length === 0) {
    line('ok', 'clean:all：没有需要清的 node_modules（已经是干净的）')
    return
  }

  out(`clean:all：将删除 ${present.length} 个目录`)
  for (const rel of present) out(`  ${rel}`)

  const { removed, failed } = cleanAll(REPO_ROOT, targets)

  if (failed.length > 0) {
    err(`\n${failed.length} 个目录删不掉：`)
    for (const { dir, error } of failed) err(`  ${dir}  ${error}`)
    throw new ViolationError(
      `clean:all 没清干净：${failed.length} 个目录删不掉（明细见上）。多半是被编辑器、语言服务这类常驻进程占着，关掉后重跑。`,
    )
  }

  line('ok', `clean:all：已删除 ${removed.length} 个目录；接下来记得重新 pnpm install`)
}
