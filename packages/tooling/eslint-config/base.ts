import type { OptionsConfig } from '@antfu/eslint-config'
import antfu from '@antfu/eslint-config'

/**
 * `antfu()` 的返回类型。
 *
 * 为什么用 `ReturnType` 而不是直接标 `FlatConfigComposer<...>`：那个类型来自 antfu 自己的依赖
 * `eslint-flat-config-utils`，本包不直接依赖它 —— 直接标名字会引入一个「未声明的依赖」
 * （knip 会报，而且 pnpm 的 `hoist: false` 下它本来也不该被隐式解析）。
 */
export type WalnutEslintConfig = ReturnType<typeof antfu>

/**
 * 平台无关基线预设：Node / 纯逻辑包（不认 Vue、不认 UnoCSS）。
 *
 * 生效方式：包根写 `eslint.config.ts` → `export default baseConfig()`。
 */
export default function baseConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
    },
    ...options,
  })
}
