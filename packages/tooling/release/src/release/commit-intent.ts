/**
 * 约定式提交 → 变更意图的分类规则 —— 纯逻辑，不碰 git、不碰磁盘。
 *
 * 与 `@walnut/commitlint-config` 的 `type-enum` **同口径**：能进 changelog / 能触发版本升级的
 * 就是下面这五类，其余一律 skip。两边漂移由 `__tests__/commitIntent.test.ts` 机械拦下。
 *
 * 不做什么：不认识「哪个包」——那是 attribution.ts 的事。本模块只回答「这条 commit 该不该发版、
 * 发哪一档、正文写什么」。
 */

/** 约定式提交前缀 → bump 类型 | `skip` */
export const BUMP_MAP: Record<string, string> = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  refactor: 'patch',
  revert: 'patch',
  docs: 'skip',
  chore: 'skip',
  style: 'skip',
  test: 'skip',
  build: 'skip',
  ci: 'skip',
}

/**
 * 破坏性变更（`type(scope)!: …`）的档位。
 *
 * 为什么是 major 而不是参考仓的 minor：参考仓的包全 private、从不发布，major 没有消费者；
 * 本仓的 `apps/*` 是真实交付物，而 release.md 与 commitlint 都把 `!` 记作 breaking，
 * 按 major 处理才与文档一致。
 */
export const BREAKING_BUMP = 'major'

/** 噪声关键词前缀（忽略匹配的 commit） */
const NOISE_PATTERNS = [
  /^(?:wip|WIP):/,
  /^(?:fixup!|squash!)/,
  /^tmp\b/i,
  /^draft\b/i,
]

export interface ParsedCommit {
  /** `git log --format=%h` 的短 hash */
  hash: string
  /** 约定式 type（小写）；无前缀时为 null */
  type: string | null
  /** 括号内的 scope；无 scope 时为 null */
  scope: string | null
  /** `type(scope)!:` 形式的破坏性标记 */
  breaking: boolean
  /** 去掉 `type(scope):` 之后的主题 */
  summary: string
}

/**
 * 这条提交是不是该被完全忽略。
 *
 * 判据（每条都有历史出处）：太短（<4 字符）、纯数字/日期（`1`、`6.4`、`0527`）、
 * `wip:` / `fixup!` / `squash!` / `tmp` / `draft` 这些草稿形态。
 */
export function isNoise(message: string): boolean {
  if (message.trim().length < 4)
    return true
  if (/^\d+(?:\.\d+)*$/.test(message.trim()))
    return true
  return NOISE_PATTERNS.some(pattern => pattern.test(message.trim()))
}

/**
 * 解析一条 `%h<US>%s` 形态的提交；无约定式前缀时 `type` 为 null（仍保留，由调用方决定要不要发版）。
 */
export function parseCommit(hash: string, subject: string): ParsedCommit | null {
  if (hash === '' || subject === '')
    return null
  if (isNoise(subject))
    return null

  const conventional = /^(\w+)(?:\(([^)]*)\))?(!)?:([\s\S]*)$/.exec(subject)
  if (conventional) {
    return {
      hash,
      type: conventional[1].toLowerCase(),
      scope: conventional[2] ? conventional[2].trim() : null,
      breaking: conventional[3] === '!',
      summary: conventional[4].trim(),
    }
  }

  // 无前缀但有意义的主题：保留，由 getBump 兜底为 patch
  return { hash, type: null, scope: null, breaking: false, summary: subject.trim() }
}

/** 该提交对应的 bump 档位；`skip` = 不发版、不进 changelog */
export function getBump(parsed: ParsedCommit): string {
  if (parsed.breaking)
    return BREAKING_BUMP
  if (parsed.type && BUMP_MAP[parsed.type] !== undefined)
    return BUMP_MAP[parsed.type]
  // 无前缀 → patch（保证变异不丢失）；未在册的 type 同样落这里
  return 'patch'
}

/**
 * 意图正文（`pnpm change --summary` 的内容）。
 *
 * 形状 `<hash> ::: <type|other> ::: <scope: 主题>` 有两个用途：
 * ① 第一段的 hash 是**幂等键**（重跑不会把同一 commit 再算一遍，见 hashFromIntentBody）；
 * ② 事后一眼看得出这条意图对应哪次提交 —— changelog 本身由 git-cliff 从 commit 渲染，
 *    所以这里不需要为了 changelog 去搬运任何链接。
 */
export function buildIntentSummary(parsed: ParsedCommit): string {
  const type = parsed.type ?? 'other'
  const prefix = parsed.scope ? `${parsed.scope}: ` : ''
  return `${parsed.hash} ::: ${type} ::: ${prefix}${parsed.summary}`
}

/** 从意图正文里读回 commit hash（幂等键）；读不到返回 null */
export function hashFromIntentBody(summary: string): string | null {
  const matched = /^\s*([0-9a-f]{7,40})\s*:::/.exec(summary)
  return matched ? matched[1] : null
}

/** 意图正文里已经记过的所有 hash（用于「这条 commit 生成过没有」） */
export function hashesInIntentBodies(bodies: string[]): Set<string> {
  const hashes = new Set<string>()
  for (const body of bodies) {
    for (const line of body.split('\n')) {
      const hash = hashFromIntentBody(line)
      if (hash)
        hashes.add(hash)
    }
  }
  return hashes
}
