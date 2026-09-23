/**
 * `script-rules.ts` 的用例（RuleTester 正反语料）。
 *
 * 这是 `@walnut/eslint-config` 的**第一套测试** —— 它此前有本地规则却零测试。
 * 之所以现在补：本地规则的失效模式是「悄悄不再命中」，而 lint 全绿看起来永远是对的。
 *
 * 用 ESLint 官方的 `RuleTester`，语料写成**纯 JS**（本规则不依赖任何 TS 语法 ——
 * `process.exit` 与 `return 数字` 都是 JS），因此不需要引入 `@typescript-eslint/parser`。
 * 真实仓库里的 `.ts` 由 `pnpm lint` 覆盖，这是集成面。
 */
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import { scriptExitCode, scriptHeader } from './script-rules.ts'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

describe('script-header', () => {
  it('正反语料', () => {
    tester.run('script-header', scriptHeader, {
      valid: [
        // 行注释文件头（本仓 bin 的现状形态）
        '// 这个脚本做某事\nimport process from \'node:process\'\nprocess.exit(0)\n',
        // JSDoc 文件头
        '/**\n * 这个脚本做某事\n */\nexport function main() { return 0 }\n',
        // shebang + 文件头
        '#!/usr/bin/env node\n// 说明\nprocess.exit(main())\n',
        // 空文件不管
        '',
      ],
      invalid: [
        {
          // 只有 shebang、没有文件头 —— 这正是本仓两个 bin 曾经的形态
          code: '#!/usr/bin/env node\nimport process from \'node:process\'\nprocess.exit(0)\n',
          errors: [{ messageId: 'missing' }],
        },
        {
          code: 'export const a = 1\n',
          errors: [{ messageId: 'missing' }],
        },
        {
          // 注释在第一个语句**之后** —— 不算文件头
          code: 'export const a = 1\n// 说明\n',
          errors: [{ messageId: 'missing' }],
        },
      ],
    })
  })
})

describe('script-exit-code', () => {
  it('正反语料', () => {
    tester.run('script-exit-code', scriptExitCode, {
      valid: [
        // 三态退出码全用上
        'function main() { return 0 }\nprocess.exit(main())\n',
        'function main() { if (a) return 1; return 2 }\nexport { main }\n',
        // 变量形态判不出，不报（本仓 bin 都是 process.exit(main())）
        'process.exit(code)\n',
        // `main` 里嵌套箭头函数返回 -1：那不是退出码
        'function main() { return [1, 2].map(x => { if (x) return -1; return x }) }\n',
        // 别的函数返回什么都与退出码无关
        'function parse() { return -1 }\n',
        // 非数字字面量不报
        'process.exit(EXIT_OK)\n',
      ],
      invalid: [
        {
          code: 'process.exit(3)\n',
          errors: [{ messageId: 'exit', data: { value: '3' } }],
        },
        {
          code: 'function main() { return 3 }\nprocess.exit(main())\n',
          errors: [{ messageId: 'mainReturn', data: { value: '3' } }],
        },
        {
          // -1 不是本仓的退出码
          code: 'process.exit(-1)\n',
          errors: [{ messageId: 'exit', data: { value: '-1' } }],
        },
      ],
    })
  })

  it('`allowed` 可配置（默认是 0/1/2）', () => {
    tester.run('script-exit-code', scriptExitCode, {
      valid: [
        { code: 'process.exit(3)\n', options: [{ allowed: [0, 3] }] },
      ],
      invalid: [
        {
          code: 'process.exit(3)\n',
          options: [{ allowed: [0, 1] }],
          errors: [{ messageId: 'exit' }],
        },
      ],
    })
  })
})
