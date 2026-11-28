import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
// oxlint 的 ignores / rules 两段与 base 共用同一份真源（批次 5 的两段式接法）
import { buildOxlintIgnores, oxlintRules } from './base.ts'
import { commentPolicyConfig } from './comment-rules'
import { sortOwnershipConfig } from './sort-ownership'
import { turboEnvVarsConfig } from './turbo-env-vars'

/**
 * 浏览器 + Vue 预设：apps/admin、apps/docs、packages/platform-web/{client,http}。
 * （`packages/generated/api-types` 用 `base` 预设 + 豁免生成物，见它自己的 `eslint.config.ts`。）
 *
 * 生效方式：包根写 `eslint.config.ts` → `export default vueConfig()`。
 */
export default function vueConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  // `ignores` 单独拆出来合并（oxlint 的全局 ignore 面与调用方的 ignores 并列，不能互相覆盖）
  const { ignores: userIgnores, ...restOptions } = options
  return antfu(
    {
      ignores: buildOxlintIgnores(userIgnores),
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
      ...restOptions,
      // 硬边界：格式的唯一真源是 oxfmt（根 `.oxfmtrc.json`），调用方也改不回去 ——
      // 两个真源并存会让两个工具互相改回去。
      stylistic: false,
    },
    // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部
    turboEnvVarsConfig(),
    // 注释里不许有 emoji（纯文字）—— 三个预设共用，理由见 comment-rules.ts 顶部
    commentPolicyConfig(),
    // ── 双轨归属（oxlint 段）────────────────────────────────────────────────
    // oxlint 只 lint `.vue` 的 **script 块**（官方兼容矩阵明示）：模板规则（`vue/*` 的模板侧、
    // unocss 工具类顺序）继续由本预设负责，**没有**搬到 oxlint —— 下面这段只关「script 侧
    // 已被 oxlint 覆盖」的规则。谁想加模板规则，加在这里，不要指望 oxlint。
    ...oxlintRules,
    // ── 排序所有权 ── 语句级 import 排序与 `package.json` 键序归 oxfmt（根 `.oxfmtrc.json`）；
    // 具名 specifier / export 语句的排序仍归 ESLint。分工与理由见 sort-ownership.ts 顶部。
    ...sortOwnershipConfig(),
    // 兜底：关掉任何漏网的格式化规则（必须最后，flat config 后份覆盖前份）
    eslintConfigPrettier,
  )
}
