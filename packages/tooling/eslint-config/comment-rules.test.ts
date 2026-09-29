/**
 * `comment-rules.ts` 的用例（RuleTester 正反语料）。
 *
 * 重点在**边界**：既要抓住「注释里的 emoji」，又**不能**碰三类别的东西 ——
 * 字符串里的 emoji（CLI 图标 / 用例断言）、排版符号（`→` `⇒`）、以及基本平面的普通符号。
 * 还盯住自动修复：删干净、不留下双空格、不碰字符串那一侧。
 */
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noEmojiInComments } from './comment-rules.ts'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

describe('no-emoji —— 注释里不许有 emoji', () => {
  it('正反语料', () => {
    tester.run('no-emoji', noEmojiInComments, {
      valid: [
        { code: '// 纯文字注释，含排版符号：A → B ⇒ C，≤ 5，—破折号' },
        { code: '/* 块注释也是纯文字 */\nconst a = 1' },
        { code: 'const s = \'CLI 图标留在字符串里：✅ ❌ ⚠️\'' },
        { code: 'const t = "⏭️ 文档断言用的标记也在字符串里"' },
        { code: 'const n = `模板字符串里的 🚀 不管`' },
        { code: 'const re = /⚠️/u' },
      ],
      invalid: [
        {
          code: '// ⚠️ 注意这一点',
          output: '// 注意这一点',
          errors: [{ messageId: 'emoji' }],
        },
        {
          code: '// 先清了一遍 ✅ 又写回去一个 🚀',
          output: '// 先清了一遍 又写回去一个',
          errors: [{ messageId: 'emoji' }],
        },
        {
          code: 'const a = 1 // 行尾注释里的 ❌',
          output: 'const a = 1 // 行尾注释里的',
          errors: [{ messageId: 'emoji' }],
        },
        {
          code: ['/**', ' * 文件头说明 ⛔', ' */', 'export const a = 1'].join('\n'),
          output: ['/**', ' * 文件头说明', ' */', 'export const a = 1'].join('\n'),
          errors: [{ messageId: 'emoji' }],
        },
        {
          // 一条注释里多处命中 → 仍报一次，但修复要把它们都删掉
          code: '// ⚠️ 甲 ✅ 乙',
          output: '// 甲 乙',
          errors: [{ messageId: 'emoji' }],
        },
      ],
    })
  })
})
