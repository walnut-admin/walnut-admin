/**
 * 排序所有权（三个预设共用的一段）—— 语句级 import 排序与 `package.json` 的**根键序**归 oxfmt。
 *
 * 2026-11-28 决策：排序的唯一真源移交 oxfmt（根 `.oxfmtrc.json` 的 `sortImports` +
 * `sortPackageJson`）。ESLint 侧因此只保留 oxfmt **做不到**的那几样：
 *   · `perfectionist/sort-named-imports` / `sort-named-exports` / `sort-exports`
 *     —— oxfmt 的 `sortImports` 只排 import **语句**，不碰具名 specifier 与 export 语句；
 *   · `package.json` 的 `jsonc/sort-keys` **窄版**：只留两组 pathPattern 子规则
 *     （`exports` 条件序、`resolutions` / `pnpm.overrides` 的 asc），根键序交 oxfmt。
 *     oxfmt 不排 `exports` 子键、也不认 overrides 子键的字符串顺序，这两组没有替身；
 *     根键序与 `dependencies` 的 asc 它都会做，两边都开就会在 `eslint --fix` 与
 *     `oxfmt --write` 之间来回改；
 *   · 其余 JSON 的排序规则**不受影响**：antfu 只为 tsconfig 与 `package.json` 定义
 *     `jsonc/sort-keys`（2026-11-28 `--print-config` 实测：`.oxfmtrc.json` 上没有这条规则）。
 *     tsconfig 的整份键序规则原样保留；`package.json` 只收窄到上面那两组子规则。
 *     别按「通用 JSON 排序」理解 —— 本仓从来没有、现在也没有这样的规则。
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
        // **窄版**：antfu 原配置有 7 组子规则（根键序 + 依赖 asc + resolutions asc +
        // workspaces.catalog(s) + exports 条件序 + gitHooks 顺序）。这里只留两组没有替身的：
        //   · `exports` 条件序（types → import → require → default）：oxfmt 的 sortPackageJson
        //     不排 exports 子键；
        //   · `resolutions` / `pnpm.overrides` 的 asc：oxfmt 不排 overrides 子键（本仓的
        //     `pnpm.overrides` 实际在 pnpm-workspace.yaml，由 yaml/sort-keys 管，这一组是
        //     防「将来搬回 package.json」）。
        // 去掉的三类都有归属：根键序与 dependencies asc 由 oxfmt 的 sortPackageJson 做；
        // workspaces.catalog(s) 在本仓不存在（catalog 在 pnpm-workspace.yaml、归 yaml 插件）；
        // gitHooks / husky 一类也不用（钩子由 lefthook.yml 托管，ADR 0018）。
        'jsonc/sort-keys': [
          'error',
          {
            pathPattern: '^exports.*$',
            order: ['types', 'import', 'require', 'default'],
          },
          {
            pathPattern: '^(?:resolutions|pnpm\\.overrides)$',
            order: { type: 'asc' },
          },
        ],
      },
    })
  }

  return configs
}
