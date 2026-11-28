/**
 * 排序所有权（三个预设共用的一段）—— 语句级 import 排序与 `package.json` 键序**归 oxfmt**。
 *
 * 2026-11-28 决策：排序的唯一真源移交 oxfmt（根 `.oxfmtrc.json` 的 `sortImports` +
 * `sortPackageJson`）。ESLint 侧因此只保留 oxfmt **做不到**的三样：
 *   · `perfectionist/sort-named-imports` / `sort-named-exports` / `sort-exports`
 *     —— oxfmt 的 `sortImports` 只排 import **语句**，不碰具名 specifier 与 export 语句；
 *   · 其余 JSON（tsconfig、`.oxfmtrc.json` 等）的 `jsonc/sort-keys` 保持原样 ——
 *     只有 `package.json` 这一文件模式交给 oxfmt（它的键序是固定的，与 antfu 的根键序不同，
 *     两边都开会在 `eslint --fix` 与 `oxfmt --write` 之间来回改）。
 *
 * **为什么单独立文件**：`base` / `vue` / `nest` 三个预设各自直接调 `antfu(...)`
 * （vue / nest 不经过 base，只共享 `oxlintRules` 这类显式导出），共用的一段必须显式共享 ——
 * 漏掉任何一个预设，那个包就会继续跑 `perfectionist/sort-imports`，与 oxfmt 互相改回去。
 *
 * **为什么 nest 要传参**：`apps/server` 的预设是 `jsonc: false`（没有注册 jsonc 插件），
 * 那里引用 `jsonc/sort-keys` 会让 ESLint 直接配置报错（Could not find plugin "jsonc"），
 * 所以只关 import 那一段；server 的 `package.json` 本来就没有键序规则，天然归 oxfmt。
 */
import type { Linter } from 'eslint'

/**
 * @param options          传给该段的开关（默认全开）。
 * @param options.packageJsonKeyOrder
 *   `false` 用于 `jsonc: false` 的预设（nest）：不生成 `**\/package.json` 的 `jsonc/sort-keys`
 *   段（未注册的插件不能出现在 rules 里）。默认 `true`。
 */
export function sortOwnershipConfig(
  options: { packageJsonKeyOrder?: boolean } = {},
): Linter.Config[] {
  const configs: Linter.Config[] = [
    {
      name: 'walnut/sort-ownership/import-statements',
      rules: {
        // 语句级 import 排序归 oxfmt（`.oxfmtrc.json` 的 `sortImports.groups`，逐组复刻
        // antfu 的 perfectionist 配置）。具名 specifier / export 三条规则**不动**。
        'perfectionist/sort-imports': 'off',
      },
    },
  ]

  if (options.packageJsonKeyOrder !== false) {
    configs.push({
      name: 'walnut/sort-ownership/package-json-keys',
      files: ['**/package.json'],
      rules: {
        // 键序归 oxfmt 的 `sortPackageJson`（依赖 / overrides 的 asc 排序它同样会做）；
        // 其他 JSON 文件的 `jsonc/sort-keys`（含 tsconfig 的固定键序）全部保留。
        'jsonc/sort-keys': 'off',
      },
    })
  }

  return configs
}
