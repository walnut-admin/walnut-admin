import type { OptionsConfig } from '@antfu/eslint-config'
import antfu from '@antfu/eslint-config'
// ⚠️ 这个相对导入**刻意不写 `.ts` 扩展名**：`nest.ts` 以类型方式引入本文件，
// 于是本文件会进 `apps/server` 的类型程序，而那份 tsconfig（ADR 0012，自包含）没开
// `allowImportingTsExtensions` —— 带扩展名会让 `@walnut/server` 的 types:check 报 TS5097。
// 本文件由 jiti 加载（不经 Node 的类型剥离），扩展名推断由它负责。
import scriptRules from './script-rules'
import { turboEnvVarsConfig } from './turbo-env-vars'

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
    // 为什么基线预设也开 pnpm：`catalog:` 是仓库级不变量（`catalogMode: strict` + `hoist: false`），
    // 而根 `eslint.config.ts` 是本预设目前唯一的消费者，它**同时管着所有没有自己 config 的包**（当前 11 个）
    // （`platform-any/*`、`platform-web/{client,http}`、`tooling/*` —— ESLint 会向上查找根配置）。
    // 这些包全是 TS-only（零 `.vue`），base 正是它们的预设；而它们的 `package.json` 依赖声明
    // 恰好是 `pnpm/json-enforce-catalog` 要守的地方。缺了 `pnpm: true`，根级与这 11 个包的
    // `package.json` / `pnpm-workspace.yaml` 就只剩通用规则（实测：会丢掉 3~4 条 `pnpm/*`）。
    pnpm: true,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
      // 与 vue 预设同一条豁免（实测：开它会在 `pnpm-workspace.yaml` 报 `shellEmulator` setting
      // mismatch）。两个预设都关，避免同一份 workspace 配置在两条路径上结论不一致。
      'pnpm/yaml-enforce-settings': 'off',
    },
    ...options,
  },
  // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部
  turboEnvVarsConfig(),
  // 脚本入口的两条形态约定（P1-19）：文件头必须有注释、退出码只能是 0/1/2。
  // 只作用于 `bin/*.ts` —— 那才是「脚本入口」；规则自身的取舍见 script-rules.ts 顶部。
  {
    files: ['**/bin/*.ts'],
    plugins: { 'walnut-script': scriptRules },
    rules: {
      'walnut-script/script-header': 'error',
      'walnut-script/script-exit-code': 'error',
    },
  })
}
