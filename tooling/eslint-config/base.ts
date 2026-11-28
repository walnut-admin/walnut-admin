import type { OptionsConfig } from '@antfu/eslint-config'
import type { Linter } from 'eslint'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import antfu from '@antfu/eslint-config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import oxlintPlugin from 'eslint-plugin-oxlint'
import { commentPolicyConfig } from './comment-rules'
// 这个相对导入**刻意不写 `.ts` 扩展名**：`nest.ts` 以类型方式引入本文件，
// 于是本文件会进 `apps/server` 的类型程序，而那份 tsconfig（ADR 0012，自包含）没开
// `allowImportingTsExtensions` —— 带扩展名会让 `@walnut/server` 的 types:check 报 TS5097。
// 本文件由 jiti 加载（不经 Node 的类型剥离），扩展名推断由它负责。
import scriptRules from './script-rules'
import { sortOwnershipConfig } from './sort-ownership'
import { turboEnvVarsConfig } from './turbo-env-vars'

/**
 * 各包的 `lint` / `lint:fix` 脚本一律写**固定并发** `--concurrency=4`，不要改回
 * `--concurrency=auto`：2026-09-29 实测 auto 会**偶发崩溃**（退出码 `0xC0000005` /
 * ACCESS_VIOLATION，实测 7 次里崩 2 次），而 `--fix` 崩在中途会**落下半修复的工作区**
 * （一部分文件已重排 import、其余没动）—— 那种状态极难发现，因为 lint 全绿。
 * 固定 4 也不慢：实测 auto 28.1s / 4 26.8s / 6 28.3s（本机 12 逻辑核）。
 */

/**
 * `antfu()` 的返回类型。
 *
 * 为什么用 `ReturnType` 而不是直接标 `FlatConfigComposer<...>`：那个类型来自 antfu 自己的依赖
 * `eslint-flat-config-utils`，本包不直接依赖它 —— 直接标名字会引入一个「未声明的依赖」
 * （knip 会报，而且 pnpm 的 `hoist: false` 下它本来也不该被隐式解析）。
 */
export type WalnutEslintConfig = ReturnType<typeof antfu>

/**
 * ── oxlint 双轨接入（批次 5 · P3）──────────────────────────────────────────────
 *
 * 真源只有一份：仓库根的 `.oxlintrc.json`（oxlint 与 ESLint 共享 ignore 面）。
 * 两段式接法：
 *   1. `oxlintIgnores`（插件从 ignorePatterns 翻出来的那一段）并进 antfu 的 `ignores` ——
 *      它就是 flat config 里「最前」的全局 ignore 段；
 *   2. `oxlintRules`（oxlint 已覆盖的规则 → ESLint 侧 `off`）放在 prettier 兜底**之前**的
 *      最后一层。顺序必须是「各包自己的配置 → oxlintRules → eslintConfigPrettier」。
 *
 * **Kibana 铁律**：双轨期只关规则、不摘插件注册 —— 历史 `eslint-disable` 指令一旦找不到
 * 规则就会报 unknown rule，那时会冒出一批与迁移无关的红。
 *
 * 与执行计划 §7.3 的写法有两处实测差异（1.95.0 的 API / 类型与文档不一致，按代码）：
 *   · `buildFromOxlintConfigFile` 是 default export 的成员，不是具名导出；
 *   · 它返回的是 **flat config 数组**（ignore 段 + rules 段，可能再拆出 vue 例外段），
 *     不是带 `.ignores` / `.rules` 的单个对象。
 * 另：插件内部 `readFileSync(filePath)` 按 **cwd** 解析，而每个包的 `lint` 脚本都以包目录
 * 为 cwd（turbo 逐包执行）⇒ 从 cwd 向上找配置文件，得到的绝对路径在根与每个包里都成立。
 * （`import.meta.url` 也想过，但本文件会进 `apps/server` 的 commonjs 类型程序，
 * `import.meta` 在那儿是 TS1343。）
 */
const OXLINT_CONFIG_FILENAME = '.oxlintrc.json'
const OXLINT_IGNORE_CONFIG_NAME = 'oxlint/oxlint-config-ignore-patterns'

function findOxlintConfig(startDir: string): string {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, OXLINT_CONFIG_FILENAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(
        `@walnut/eslint-config: 未找到 ${OXLINT_CONFIG_FILENAME}（从 ${startDir} 向上）`,
      )
    }
    dir = parent
  }
}

const oxlintConfigs = oxlintPlugin.buildFromOxlintConfigFile(findOxlintConfig(process.cwd()))
const oxlintIgnoreConfig = oxlintConfigs.find((config) => config.name === OXLINT_IGNORE_CONFIG_NAME)

/** 并进 antfu 的 `ignores`（全局 ignore 段，必须最前）。 */
export const oxlintIgnores: string[] = oxlintIgnoreConfig?.ignores ?? []
/** 放在 prettier 兜底之前的最后一层（只关规则，不摘插件）。 */
export const oxlintRules: Linter.Config[] = oxlintConfigs.filter(
  (config) => config !== oxlintIgnoreConfig,
)

/**
 * 把「oxlint 的 ignore 面」与调用方的 `ignores` 合成 antfu 的 `ignores` 选项。
 *
 * `OptionsConfig['ignores']` 允许数组或 `(originals) => string[]` 两种形态；这里两种都支持
 * （调用方给函数时，它收到的 originals 已经带上 oxlint 的 ignore 面）。
 * `extraIgnores` 给预设自己的固定豁免用（nest 的 public/js 与 scripts 等）。
 */
export function buildOxlintIgnores(
  userIgnores: OptionsConfig['ignores'],
  extraIgnores: string[] = [],
): (originals: string[]) => string[] {
  return (originals) => {
    const merged = [...originals, '**/dist/**', 'pnpm-lock.yaml', ...extraIgnores, ...oxlintIgnores]
    return typeof userIgnores === 'function'
      ? userIgnores(merged)
      : [...merged, ...(userIgnores ?? [])]
  }
}

/**
 * 平台无关基线预设：Node / 纯逻辑包（不认 Vue、不认 UnoCSS）。
 *
 * 生效方式：包根写 `eslint.config.ts` → `export default baseConfig()`。
 */
export default function baseConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  // `ignores` 单独拆出来合并：oxlint 的全局 ignore 面与调用方的 ignores 是**并列**关系，
  // 不能让 `...restOptions` 把其中一份覆盖掉（对象展开里后写的 key 整体胜出）。
  const { ignores: userIgnores, ...restOptions } = options
  return antfu(
    {
      ignores: buildOxlintIgnores(userIgnores),
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
      ...restOptions,
      // 硬边界：格式的唯一真源是 oxfmt（根 `.oxfmtrc.json`）。放在 `...restOptions` 之后 ——
      // 调用方也改不回去，否则会出现「oxfmt 写一套、ESLint 要求另一套」的来回改。
      stylistic: false,
    },
    // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部
    turboEnvVarsConfig(),
    // 注释里不许有 emoji（纯文字）—— 三个预设共用，理由见 comment-rules.ts 顶部
    commentPolicyConfig(),
    // 脚本入口的两条形态约定（P1-19）：文件头必须有注释、退出码只能是 0/1/2/3（四态）。
    // 只作用于 `bin/*.ts` —— 那才是「脚本入口」；规则自身的取舍见 script-rules.ts 顶部。
    {
      files: ['**/bin/*.ts'],
      plugins: { 'walnut-script': scriptRules },
      rules: {
        'walnut-script/script-header': 'error',
        'walnut-script/script-exit-code': 'error',
      },
    },
    // ── oxlint 去重段 ── 把 oxlint 已覆盖的规则在 ESLint 侧关掉（只关规则、不摘插件注册）。
    // 位置固定：各包自己的配置之后、prettier 兜底之前（见文件上方两段式说明）。
    ...oxlintRules,
    // ── 排序所有权 ── 语句级 import 排序与 `package.json` 的**根键序**归 oxfmt
    // （根 `.oxfmtrc.json`）；具名 specifier / export 语句的排序与 package.json 的
    // `exports` 条件序 / `pnpm.overrides` asc 仍归 ESLint（oxfmt 做不到）。分工与理由见 sort-ownership.ts 顶部。
    // 放在各包配置之后：调用方不能把它改回去，否则会与 oxfmt 互相改写。
    ...sortOwnershipConfig(),
    // 兜底：万一有格式化规则漏网（第三方预设自带、或某条 ours 显式打开），由它关掉，
    // 防止两个工具互相改回去。**必须最后**：flat config 后份覆盖前份。
    eslintConfigPrettier,
  )
}
