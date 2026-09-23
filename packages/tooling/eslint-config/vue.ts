import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
import { turboEnvVarsConfig } from './turbo-env-vars'

/**
 * 浏览器 + Vue 预设：apps/admin、apps/docs、packages/platform-web/*。
 *
 * 生效方式：包根写 `eslint.config.ts` → `export default vueConfig()`。
 */
export default function vueConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
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
  },
  // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部
  turboEnvVarsConfig())
}
