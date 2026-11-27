import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import { commentPolicyConfig } from './comment-rules'
import { turboEnvVarsConfig } from './turbo-env-vars'

/**
 * 浏览器 + Vue 预设：apps/admin、apps/docs、packages/platform-web/{client,http}。
 * （`packages/generated/api-types` 用 `base` 预设 + 豁免生成物，见它自己的 `eslint.config.ts`。）
 *
 * 生效方式：包根写 `eslint.config.ts` → `export default vueConfig()`。
 */
export default function vueConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  return antfu(
    {
      ignores: ['**/dist/**', 'pnpm-lock.yaml'],
      markdown: false,
      unocss: true,
      vue: true,
      typescript: true,
      pnpm: true,
      rules: {
        'ts/no-namespace': 'off',
        'no-console': 'off',
        'regexp/no-unused-capturing-group': 'off',
        'pnpm/yaml-enforce-settings': 'off',
      },
      ...options,
      // 硬边界：格式的唯一真源是 oxfmt（根 `.oxfmtrc.json`），调用方也改不回去 ——
      // 两个真源并存会让两个工具互相改回去。
      stylistic: false,
    },
    // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部
    turboEnvVarsConfig(),
    // 注释里不许有 emoji（纯文字）—— 三个预设共用，理由见 comment-rules.ts 顶部
    commentPolicyConfig(),
    // 兜底：关掉任何漏网的格式化规则（必须最后，flat config 后份覆盖前份）
    eslintConfigPrettier,
  )
}
