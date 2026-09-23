/**
 * 升级级别汇总与意图 frontmatter 改写 —— 纯逻辑，无 IO。
 *
 * 为什么单独成模块：`resolveAutoBump` 的 `none` 语义与 `overrideIntentBump` 的改写范围
 * 都有过真实缺陷（见各自注释），收在一处才好用测试钉住。
 */

import type { Bump, Intent } from './intents.ts'
import { bumpPriority, parseFrontmatterLine } from './intents.ts'

/** 自动检测：取所有意图里**非 none** 的最高档；全 none（或没有意图）返回 `none` */
export function resolveAutoBump(intents: Intent[]): Bump {
  let best: Bump = 'none'
  for (const intent of intents) {
    if (intent.bump === 'none')
      continue
    if (bumpPriority(intent.bump) > bumpPriority(best))
      best = intent.bump
  }
  return best
}

/** 这个档位会不会真的改版本号（`none` = 明确声明本次不发版） */
export function bumpChangesVersion(bump: Bump): boolean {
  return bump !== 'none'
}

/** 汇总出的人类标签 */
export function bumpLabel(bump: Bump): string {
  if (bump === 'none')
    return 'none（不发版）'
  return bump
}

/**
 * 把一个意图文件的 frontmatter 里的所有包行改写成指定档位。
 *
 * ⚠️ 必须改**全部**包行：早先的实现用 `/^("[^"]+":\s*)\w+(\s*\n---)/m` —— 带了 `m` 却没带 `g`，
 * 于是一个提及多个包的意图只有第一行被改写，其余行保留原档；多包意图在本仓很常见
 * （auto 生成的一条提交可命中多个包），所以那种写法会让用户选的档位只生效一半。
 *
 * 只改 frontmatter 段（`---` 之间），正文里的同形文字不动。
 */
export function overrideIntentBump(content: string, bump: Bump): { content: string, changed: number } {
  const normalized = content.replace(/\r\n/g, '\n')
  const matched = /^---\n([\s\S]*?)\n---/.exec(normalized)
  if (!matched)
    return { content, changed: 0 }

  let changed = 0
  const frontmatter = matched[1]
    .split('\n')
    .map((line) => {
      const entry = parseFrontmatterLine(line)
      if (!entry)
        return line
      if (entry.bump === bump)
        return line
      changed++
      return `${entry.prefix}${bump}${entry.suffix}`
    })
    .join('\n')

  if (changed === 0)
    return { content, changed: 0 }
  return { content: normalized.replace(matched[1], frontmatter), changed }
}
