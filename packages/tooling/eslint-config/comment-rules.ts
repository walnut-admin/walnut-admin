/**
 * 本地规则：**注释里不许有 emoji**（纯文字）。三个预设共用的一段。
 *
 * ## 为什么要有它
 *
 * emoji 在**非 UTF-8 代码页**的终端里必然显示成乱码（Windows 中文环境实测：`` 打成
 * `鈿狅笍`、`` 打成 `鉁?`），而它们又不像中文那样有稳定的双字节表示 —— `` 是
 * `U+26A0 U+FE0F`（基础字符 + **变体选择符**），`` 之类更是在基本平面之外（代理对）。
 * 于是同一份文件在「能正确显示中文」的管道里，emoji 照样会坏 —— 本次实测就是这样：
 * 中文没坏、emoji 坏了，看起来像「注释写成了乱码」。
 *
 * 代价还不止显示：emoji 会污染 `git diff`（一行里混入不可见码点）、进日志/截图后无法检索，
 * 而且**没有任何东西在查它** —— 靠人记是记不住的（本次先手工清了一遍自己的，紧接着又写回去一个）。
 *
 * ## 判据：只查注释，不查字符串
 *
 * 这是刻意的收窄：CLI 的输出图标（`packages/tooling/scripts/src/lib/log.ts` 的 `ok: ''`）、
 * 用例里对文档的逐字断言（发版电池表的 ``）、以及文档站正文里的标记，都**不在本规则范围内**
 * （它们不是注释；文档站那份是 markdown，本仓 eslint 也刻意不 lint markdown）。
 *
 * ## 刻意**不**算 emoji 的字符（否则会大面积误报）
 *
 * 本仓注释大量使用排版符号：`→`（U+2192）、`⇒`（U+21D2）、`≤`、`≠`、`·`、`—`；它们都是
 * 基本平面里的普通符号，在终端里显示正常、也从来不是 emoji。所以范围只收**真正的 emoji 区**
 * 与**变体选择符 / 零宽连接符**。
 *
 * `fixable`：能自动修（删掉 emoji，顺带吃掉紧跟的一个空格），所以存量可以一条命令清干净。
 */
import type { Rule } from 'eslint'

/**
 * emoji 判定面：`\p{Extended_Pictographic}`（图形字符，覆盖基本平面内外的主流 emoji）
 * 加上变体选择符与零宽连接符。
 *
 * 刻意**不含** `U+2190–U+21FF`（箭头 `→` `⇒`）与 `U+2200–U+22FF`（数学算子 `≤` `≠`）等排版符号
 * —— 它们不是 emoji，本仓注释大量在用，误报会把这条规则变成噪声源。
 *
 * 判定面是**手写的 Unicode 区块**（见下面 `EMOJI`），刻意**不用** `\p{Extended_Pictographic}` ——
 * 后者宽得多：它把 `↔` 这类排版箭头也算 emoji（本仓注释在用），误报会让规则变成噪声源。
 * 同一份区块也用在 `pnpm lint:emoji` 那条跨文件类型的门禁里
 * （`packages/tooling/scripts/src/lib/emoji-ranges.ts`，那份文件顶部写了为什么是两份实现）。
 * **改一边要改另一边**，两边各有一条用例钉住同一份"该报/不该报"的语料。
 *
 * 这里也刻意**不把示例字符写进注释**：写了会被本规则自己命中（第一次跑 `lint:fix` 时正是这样，
 * 文档块里的示例字符被自己的 autofix 删成了空反引号）。要查具体字符请按码点搜。
 *
 * 变体选择符与零宽连接符是**有意放进字符类的** —— 它们常与图形字符粘在一起出现，只匹配图形字符
 * 会漏掉「emoji 形态」那一位（那一位正是终端乱码的元凶）。因此这里豁免 `no-misleading-character-class`：
 * 那条规则防的是「无意中把组合字符写进类」，而这里是明确的意图（同时 `regexp/prefer-character-class`
 * 要求用字符类而不是择一分支 —— 两条规则在此冲突，取了字符类这一侧）。
 */

// eslint-disable-next-line no-misleading-character-class -- 变体选择符与零宽连接符是**有意**入类的（见上方说明）
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}\uFE0F\u200D]/u

/** 匹配 emoji 串（含紧跟的一个空格），用于自动修复；豁免理由同上 */
// eslint-disable-next-line no-misleading-character-class -- 同上
const EMOJI_RUN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}\uFE0F\u200D]+ ?/gu

/**
 * **不是 emoji 的排版符号**：版权、注册商标、商标。
 *
 * 它们**落在 `\p{Extended_Pictographic}` 里**（Unicode 把版权符号也标成了带 Emoji 属性的字符，
 * 配上变体选择符确实能当 emoji 用），但在本仓的用法是**法律声明**那一类。实测代价：规则第一版
 * 把它们当 emoji 删掉了 —— `apps/admin/src/store/types.d.ts` 的 JSDoc `@default Copyright © …`
 * 被改，**随仓库提交的生成物** `.vscode/settings-dev.schema.json` 随之漂移。这三个符号在终端里
 * 显示正常、也从不乱码，所以直接豁免，而不是靠 `eslint-disable` 到处兜。
 */
const NOT_EMOJI = /^[\u00A9\u00AE\u2122\s]+$/u

/** 命中的片段里剔除「纯排版符号」的那些 */
function realHits(raw: string): RegExpMatchArray[] {
  return [...raw.matchAll(EMOJI_RUN)].filter(m => !NOT_EMOJI.test(m[0]))
}

/** 报错时把命中的字符列出来（最多 3 个），便于定位 */
function describe(matches: readonly string[]): string {
  return [...new Set(matches.map(m => m.trim()))].slice(0, 3).join(' ')
}

const noEmojiInComments: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Disallow emoji in comments (plain text only)',
    },
    schema: [],
    messages: {
      emoji: '注释里不许用 emoji（纯文字）：{{chars}}。它们在非 UTF-8 代码页的终端里会显示成乱码，也会污染 diff 与日志；排版符号（→ ⇒ ≤）不受影响。',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          // 用**原文**（含 `//` / `/* */` / `#` 这些定界符）来算范围，修起来与语言无关
          const raw = sourceCode.getText(comment as never)
          const base = comment.range?.[0] ?? 0
          const hits = realHits(raw).map(m => m[0])
          if (hits.length === 0)
            continue

          context.report({
            loc: comment.loc as never,
            messageId: 'emoji',
            data: { chars: describe(hits) },
            fix: (fixer) => {
              const ranges: [number, number][] = []
              for (const m of realHits(raw)) {
                const start = m.index ?? 0
                // `EMOJI_RUN` 已经吃掉一个**尾随**空格；没有尾随空格时（emoji 在行尾）改吃一个**前导**
                // 空格 —— 否则修复会留下一串多余空格，等于换了个形态的脏。
                const from = m[0].endsWith(' ') || raw[start - 1] !== ' ' ? start : start - 1
                ranges.push([base + from, base + start + m[0].length])
              }
              return ranges.map(([f, t]) => fixer.removeRange([f, t]))
            },
          })
        }
      },
    }
  },
}

const plugin: { rules: Record<string, Rule.RuleModule> } = {
  rules: { 'no-emoji': noEmojiInComments },
}

/** 三个预设共用的一段：把规则挂到 `walnut-comment` 命名空间下并对所有文件生效 */
export function commentPolicyConfig() {
  return {
    plugins: { 'walnut-comment': plugin },
    rules: { 'walnut-comment/no-emoji': 'error' as const },
  }
}

export default plugin
export { EMOJI, EMOJI_RUN, noEmojiInComments }
