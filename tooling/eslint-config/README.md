# `@walnut/eslint-config` —— 共享 ESLint 预设

> flat config（`eslint.config.ts`）的三个预设，构建在 `@antfu/eslint-config` 之上。
> `eslint` 是 `peerDependencies`，插件住本包 `dependencies` —— 消费方只挑预设，不自己装插件
> （[ADR 0014](../../apps/docs/src/zh-CN/content/adr/0014-eslint-config-strategy.md)）。
> 本仓**没有 Prettier**：格式的唯一真源是 **oxfmt**（根 `.oxfmtrc.json`）—— 三个预设都是
> `stylistic: false`，末尾接 `eslint-config-prettier/flat` 兜底；ESLint 只留非格式规则
> （[ADR 0031](../../apps/docs/src/zh-CN/content/adr/0031-rust-toolchain-migration.md)）。
> **排序也归 oxfmt**（`sortPackageJson: true` + `sortImports` 全量开启，2026-11-28 最终决策）：
> ESLint 侧只关 `perfectionist/sort-imports`（见 `sort-ownership.ts`），并保留 oxfmt 做不到的
> `sort-named-imports` / `sort-named-exports` / `sort-exports` 与 `package.json` 的**窄版**
> `jsonc/sort-keys`（`exports` 条件序 + `resolutions` / `pnpm.overrides` asc；根键序归 oxfmt）。

## 三个预设：按**运行环境**分

| 导出 | 适用面 | 相对基线多了什么 |
|------|--------|------------------|
| `./base` → `base.ts` | 平台无关的 TS 包；**根 `eslint.config.ts`** 用的就是它 | 基线：`pnpm: true`、关 `markdown` |
| `./vue` → `vue.ts` | 浏览器 + Vue（`apps/admin`、`apps/docs`、`packages/platform-web/*`） | `vue` / `unocss` / `typescript` |
| `./nest` → `nest.ts` | NestJS 后端（`apps/server`） | TypeScript project 模式 + 后端禁令与本地规则 |

三个预设各自直接调 `antfu(...)`（`nest` 不经过 `base`），所以共用的**三段**必须显式挂上：
`turbo-env-vars.ts`（Turbo 未声明环境变量）、`comment-rules.ts`（注释里不许有 emoji）与
`sort-ownership.ts`（排序所有权 —— 漏掉任何一个预设，那个包就会继续跑
`perfectionist/sort-imports`，与 oxfmt 互相改回去）。

## 怎么消费

```ts
// 根 eslint.config.ts —— 同时是**没有自己配置**的包的生效配置（ESLint 向上查找）
import baseConfig from '@walnut/eslint-config/base'
export default baseConfig()
```

```ts
// apps/admin/eslint.config.ts
import vueConfig from '@walnut/eslint-config/vue'
export default vueConfig({ ignores: ['public/vendor/**'] })
```

```ts
// apps/server/eslint.config.ts —— append() 追加分层门禁等本地配置段
import nestConfig, { DATA_SCOPE_DIRECT_REPOSITORY_SELECTOR } from '@walnut/eslint-config/nest'
export default nestConfig().append(/* … */)
```

预设签名都是 `(options: OptionsConfig = {}) => WalnutEslintConfig`，`...options` **最后展开**，
所以消费方的 `rules` / `ignores` 覆盖预设；返回值是 `ReturnType<typeof antfu>`，支持 `.append()`。
`packages/generated/api-types` 用 `baseConfig().append({ ignores: [...] })` 豁免生成物。

**例外：有几段刻意不可被消费方覆盖** —— `stylistic`（`false`）、`oxlint` 去重段、
`sort-ownership` 与 `eslint-config-prettier` 兜底挂在 `...options` **之后**。它们是「格式 / 排序
只有一个真源」的机械保证：允许消费方用 `stylistic: true` 或重新打开 `perfectionist/sort-imports`
等于把两个真源又接回来。要改这些面就改本包（或 ADR），别在消费方传 options。

## 契约与扩展点

**共用两段**（三个预设都有，缺一个就等于那个预设静默少了检查）：

- `turbo/no-undeclared-env-vars`：判据的唯一真源是根 `turbo.json`。因此**新增外部环境变量必须同步
  `turbo.json`**；框架内建（`import.meta.env.DEV` 等）、运行时注入与测试夹具的豁免清单在本包
  `turbo-env-vars.ts`，加条目要写理由。
- `walnut-comment/no-emoji`：只查**注释**、不查字符串，排版符号（`→` `⇒` `≤`）不算 emoji。
  同一份字符区段也用在 `pnpm walnut lint:emoji` 的门禁里（`tooling/scripts` 那份），**改一边要改另一边**。

**`base` 的额外一段**：`walnut-script/script-header` 与 `walnut-script/script-exit-code`，只作用于
`**/bin/*.ts` —— 文件头必须有一段注释；退出码只能是四态 `0/1/2/3`。规则语义与取舍见 `script-rules.ts`。

**`nest` 的额外内容**：`local/sort-nestjs-decorators`（装饰器 / 参数顺序，表在
`nest-local-rules.ts`）、`local/no-cross-lib-relative-import`（只在 `libs/<name>/` 内生效，
`apps/server` 的配置把它开到 `libs/**`）、禁止 import `@walnut/client` / `@walnut/http`，
以及数据权限直连禁令（`no-restricted-syntax`，selector 与文案**导出**给消费方复用）。

**关掉某个包的一条规则**：在该包写本地 `eslint.config.ts`，`预设({ rules: { '<rule>': 'off' } })`。
flat config 的注意事项：**同一个 rules key 后份整体覆盖前份** —— 若你要覆盖的是
`no-restricted-syntax`，必须把仍然想要的 selector 一起带上（`DATA_SCOPE_*` 导出就是为了这个），
否则已有的保护会静默消失，已有的 `eslint-disable` 会变成「未使用指令」。

## 已知限制

- 预设由 **ESLint 经 jiti 加载**（不是 Node 原生类型剥离），所以 tsconfig 用 `base.json` 预设。
  包内相对 import **刻意不写 `.ts` 扩展名**：`base.ts` / `nest.ts` 会进 `apps/server` 的类型程序，
  而那份 tsconfig（ADR 0012，自包含）没开 `allowImportingTsExtensions`。别「顺手统一」。
- `nest` 的 `typescript.tsconfigPath` 是**相对被 lint 的包根**解析（写的是 `./tsconfig.json`）。
- `nest` 里 `ts/no-unsafe-*` 降为 `warn`：pnpm workspace symlink 下类型无法穿透，属已知误报
  （ADR 0012）。`tsc --noEmit` 仍是零错误的唯一判据。
- 本包**不在**根 `turbo.json` 的 `globalDependencies` 里（那里有 `tooling/tsconfig` 与
  `tooling/vitest-config` 的预设）：改预设后，别的包的 `lint` 可能命中旧缓存 ——
  验证规则改动请用 `pnpm exec turbo run lint --force --filter=<包>`。

本地规则各有 RuleTester 正反语料（`*.test.ts`）：`pnpm --filter @walnut/eslint-config test`。
判据是「规则有没有悄悄不再命中」，lint 全绿看不出来。
