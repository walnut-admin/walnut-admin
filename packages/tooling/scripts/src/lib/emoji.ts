/**
 * emoji 判定与剔除 —— 给"注释里不许有 emoji"这条**跨文件类型**的门禁用。
 *
 * ## 与 ESLint 那条规则的关系（刻意的重复，说明白免得下次有人来"合并"）
 *
 * `packages/tooling/eslint-config/comment-rules.ts` 里有一条本地规则 `walnut-comment/no-emoji`，
 * 它管的是 **ESLint 能 lint 的文件**（各包的 ts/vue/json/yaml…）。但 `.github/workflows/*.yml`、
 * `.gitignore`、`cliff.toml`、`deploy/nginx/*.conf`、`lefthook.yml` 这些**不在 ESLint 覆盖面里**
 * —— 实测就是这么漏掉 20 处的。
 *
 * 于是判据有了两份实现。为什么不抽成一份共享：`eslint-config` 与 `scripts` 是两个互不依赖的
 * tooling 包，为一小段 Unicode 范围建立一个跨包依赖不划算（还会让 ESLint 预设多一个 workspace
 * 依赖面）。**代价是范围可能漂移**，所以两边各有一条用例钉住同一份"该报/不该报"的语料
 * （emoji 要报；`©` `®` `™` 与排版符号 `→` `⇒` `≤` 不报）。改一边记得改另一边。
 *
 * ## 为什么不把 emoji 一次判干净
 *
 * `\p{Extended_Pictographic}` 里包含 `©`（版权）这类符号 —— 本仓把它用在法律声明里，
 * 删掉它属于误伤（实测真发生过：JSDoc 里的 `@default Copyright © …` 被改，
 * 随仓库提交的生成物 schema 跟着漂移）。所以这里显式豁免 `©` `®` `™`。
 */
import { EMOJI_RANGES } from './emoji-ranges.ts'

/** 单个 emoji 字符（含变体选择符 / 零宽连接符） */
export const EMOJI_CHAR = new RegExp(`[${EMOJI_RANGES}]`, 'u')

/** 一段连续的 emoji（含紧跟的一个空格），用于剔除 */
export const EMOJI_RUN = new RegExp(`[${EMOJI_RANGES}]+ ?`, 'gu')

/** 豁免：版权 / 注册商标 / 商标 —— 不是 emoji 语义，且在终端里显示正常 */
const NOT_EMOJI = /^[\u00A9\u00AE\u2122\s]+$/u

export interface EmojiHit {
  /** 行号（从 1 开始） */
  line: number
  /** 命中的字符（去重后最多 3 个） */
  chars: string
}

/** 找出一段文本里所有 emoji（按行报告；纯排版符号不算） */
export function findEmoji(text: string): EmojiHit[] {
  const hits: EmojiHit[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    const matched = [...line.matchAll(EMOJI_RUN)].map(m => m[0]).filter(m => !NOT_EMOJI.test(m))
    if (matched.length > 0)
      hits.push({ line: index + 1, chars: [...new Set(matched.map(m => m.trim()))].slice(0, 3).join(' ') })
  })
  return hits
}

/**
 * 剔除一段文本里的 emoji（含相邻的一个空格，免得留下双空格）。
 *
 * 与 ESLint 那条规则的 fixer 同口径：优先吃掉**尾随**空格；emoji 在行尾时改吃**前导**空格。
 */
export function stripEmoji(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let out = ''
      let last = 0
      for (const m of line.matchAll(EMOJI_RUN)) {
        if (NOT_EMOJI.test(m[0]))
          continue
        const start = m.index ?? 0
        const from = m[0].endsWith(' ') || line[start - 1] !== ' ' ? start : start - 1
        out += line.slice(last, from)
        last = start + m[0].length
      }
      return out + line.slice(last)
    })
    .join('\n')
}
