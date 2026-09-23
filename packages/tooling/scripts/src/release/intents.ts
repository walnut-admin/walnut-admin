/**
 * 意图（`.changeset/*.md`）解析与版本算术 —— 纯逻辑，无 IO。
 *
 * 意图文件格式就是 changesets 格式（pnpm 原生 release management 沿用），但解析要多容忍几件事：
 * 本仓脚本写出来的文件名与正文是 `pnpm change` 产物，历史文件可能来自手写或旧工具
 * （引号包名 / 裸包名 / `./` 目录引用 / CRLF）。
 *
 * 升级级别多一个 `none`：它是「这次不发版」的显式声明，**不参与最大值**（见 bump.ts）。
 */

export type Bump = 'major' | 'minor' | 'patch' | 'none'

export interface Intent {
  /** 意图文件名（不含目录），例如 `auto-1a82770.md` */
  file: string
  /** frontmatter 里点名的包（保持出现顺序，去重） */
  packages: string[]
  /** 多包意图取最高级别 */
  bump: Bump
  /** `---` 之后的正文（已 trim） */
  summary: string
}

const BUMP_PRIORITY: Record<Bump, number> = {
  major: 3,
  minor: 2,
  patch: 1,
  none: 0,
}

export function isBump(value: string): value is Bump {
  return value === 'major' || value === 'minor' || value === 'patch' || value === 'none'
}

/** bump 优先级：major=3 / minor=2 / patch=1 / none=0（none 永远不参与取最大） */
export function bumpPriority(bump: Bump): number {
  return BUMP_PRIORITY[bump]
}

/**
 * semver 下一个版本号（**判别式**：不认识的输入返回 null，绝不猜）。
 *
 * 为什么不用一个 semver 依赖：本仓只需要 major/minor/patch 三个整数位的加法，而引一个包要改
 * catalog + 锁文件。带 prerelease / build 元数据的版本在这里返回 null —— 本仓不发布、不用 lane，
 * 出现那种版本号说明有人手工改了 manifest，应当响亮报错而不是按 patch 算出一个更错的号。
 */
export function nextVersion(version: string, bump: Bump): string | null {
  if (bump === 'none')
    return version
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!matched)
    return null
  const major = Number(matched[1])
  const minor = Number(matched[2])
  const patch = Number(matched[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch))
    return null
  if (bump === 'major')
    return `${major + 1}.0.0`
  if (bump === 'minor')
    return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * 解析意图文件正文。
 *
 * 判据：必须能切出 `---\n<frontmatter>\n---`，且 frontmatter 里至少有一行带 bump。
 * 容忍：LF / CRLF；包名带或不带双引号；`./packages/xxx` 形式的目录引用（pnpm 在包名有歧义时
 * 会这么写，见 https://pnpm.io/cli/change 「Referencing packages by directory」）；
 * **没有正文**（手写的、只有 frontmatter 的意图）。
 *
 * ⚠️ 「没有正文」这一条是修出来的：早先的正则要求 `---` 之后**要么**是「空行 + 正文」**要么**直接是
 * 行尾，于是 `---\n<fm>\n---\n`（既有换行、又没有正文）两条都不满足 ⇒ 整个意图返回 null，
 * 而 `readIntents()` 对解析失败的文件是**静默跳过**的 —— 一个手写的无正文意图会无声地不参与
 * 自动档位汇总（用户以为写了，实际没生效）。静默丢信息正是本仓最想避免的形态。
 */
export function parseIntent(file: string, content: string): Intent | null {
  const normalized = content.replace(/\r\n/g, '\n')
  const matched = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(normalized)
  if (!matched)
    return null

  const packages: string[] = []
  let maxBump: Bump | null = null

  for (const rawLine of matched[1].split('\n')) {
    // "pkg": patch   /   pkg: patch   /   "./packages/x": minor
    // 复用 bump.ts 的行解析（同一条判据被两处需要，收在一处才不会漂）
    const entry = parseFrontmatterLine(rawLine)
    if (!entry || !isBump(entry.bump))
      continue
    const { name } = entry
    const bump = entry.bump
    if (!packages.includes(name))
      packages.push(name)
    // `none` 不参与取最大：它只声明「这个包这次不发版」
    if (bump !== 'none' && (maxBump === null || bumpPriority(bump) > bumpPriority(maxBump)))
      maxBump = bump
  }

  if (packages.length === 0 || maxBump === null)
    return null

  return { file, packages, bump: maxBump, summary: (matched[2] ?? '').trim() }
}

/** 一组意图里是否**全部**是 none（= 明确声明本次不发版） */
export function allNone(intents: Intent[]): boolean {
  return intents.length > 0 && intents.every(intent => intent.bump === 'none')
}

/**
 * 把一行 frontmatter 拆成「名字 + 档位 + 包围空白」。
 *
 * 刻意**不用**一条大正则：`(\s*)([^"':]+)\s*:\s*(\w+)(\s*)` 里的 `\s*` 与 `[^"':]+` 可以互相
 * 交换字符，是可被构造出多项式回退的形态（`regexp/no-super-linear-backtracking` 会报）。
 * 按第一个冒号切开，两侧各做无歧义的判定，既好读也好测。
 *
 * 名字侧：剥掉一层成对引号后不得为空、不得再含引号或冒号（`"./packages/x"` 这种目录引用合法）。
 * 档位侧：`\w+` 后面只许有空白。
 *
 * 放在本模块（而不是 bump.ts）的原因：解析与改写同属「意图 frontmatter」这件事，
 * 而 bump.ts 已经 import 本模块 —— 反过来放会形成循环 import。
 */
export function parseFrontmatterLine(line: string): { name: string, prefix: string, bump: string, suffix: string } | null {
  const colon = line.indexOf(':')
  if (colon < 0)
    return null

  const leading = /^\s*/.exec(line)?.[0] ?? ''
  /**
   * 名字的原样文本（**保留引号**）—— `prefix` 必须用它重建，不能用下面剥过引号的 `name`。
   *
   * ⚠️ 这条是实测踩出来的：`@` 是 YAML 的保留指示符，**不能作为 plain scalar 的开头**，
   * 所以包名必须带引号（`"@walnut/admin": patch`）。早先用剥引号后的名字重建 prefix，
   * 于是 `--bump` 改写会把 `"@walnut/admin": patch` 写成 `@walnut/admin: minor` ——
   * 那不是合法 YAML，pnpm 再也读不了这个意图文件，用户选的档位直接丢失。
   */
  const rawName = line.slice(0, colon).trim()
  let name = rawName
  if (name.length >= 2 && ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith('\'') && name.endsWith('\''))))
    name = name.slice(1, -1)
  if (name === '' || name.includes(':') || name.includes('"') || name.includes('\''))
    return null

  const tail = /^(\s*)(\w+)(\s*)$/.exec(line.slice(colon + 1))
  if (!tail)
    return null

  return {
    name,
    prefix: `${leading}${rawName}:${tail[1]}`,
    bump: tail[2],
    suffix: tail[3],
  }
}
