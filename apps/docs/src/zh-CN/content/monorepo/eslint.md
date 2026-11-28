# ESLint 配置

## 概述

Walnut Admin 使用 **ESLint 10.3 flat config** + `@antfu/eslint-config` 作为统一的代码检查方案。配置通过 `@walnut/eslint-config` 共享包分发给所有 workspace 成员。**格式化已从 ESLint 拆出**，由 oxfmt 承担（见第 4 节）。

## 我们做了什么

### 1. Flat Config 迁移

ESLint v9+ 默认只支持 flat config（`eslint.config.ts`）。旧的 `.eslintrc.*` 格式已被废弃。项目已完成全量迁移：

```ts
// root eslint.config.ts — 全仓库入口
import baseConfig from '@walnut/eslint-config/base'

export default baseConfig()
```

> ⚠️ 这个文件的作用域**不止根目录**：大多数包没有自己的 `eslint.config.ts`，ESLint 会
> **向上查到本文件** —— 它们全是 TS-only（零 `.vue`），`base` 正是它们该用的预设。
> 自带配置的例外都有理由（清单见下方第 2 节，不在这里抄）：server 用 nest 预设、
> admin / docs 用 vue 预设，其余自带配置的包用 `base` + 各自的 `ignores`。
> 2026-09-23 之前根入口用的是 `vue` 预设，等于给无配置的包白装了 vue / unocss 插件。

> 2026-09-23 起，仓库里**没有任何 `.mjs` / `.cjs` 文件**：所有包级 `eslint.config.ts`、`eslint-config` 的预设与本地规则插件、commitlint 配置与 config 包、`@walnut/scripts` 的 `bin/` 脚本、contract 的 `build-barrel` 脚本全部改成 `.ts`（数量随增删而变，以各包 `package.json` / 目录为准）。ESLint 加载 `eslint.config.ts` 需要 **`jiti`**（ESLint 官方的 TS 配置加载器），因此根 `devDependencies` 新增了它。详见 [ADR-0019](/content/adr/0019-tsconfig-presets-and-no-mjs)。

### 2. 共享 ESLint Config 包

[`@walnut/eslint-config`](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/eslint-config) 提供三种预设：

| 预设 | 文件 | 适用场景 |
|------|------|---------|
| `vue` | `vue.ts` | `apps/admin`、`apps/docs`——Vue 3 + TypeScript（+ UnoCSS） |
| `nest` | `nest.ts` | `apps/server`——NestJS + CJS + decorators（带本地装饰器排序规则 `nest-local-rules.ts`） |
| `base` | `base.ts` | **根 `eslint.config.ts`**、`apps/e2e`、`packages/generated/api-types`，以及没有自己配置的包（platform-any/*、platform-web/*、tooling/*）—— 纯平台无关基线（不开 Vue / UnoCSS）+ 两条脚本入口规则 `script-rules.ts` |

各消费者在包根写一行 `eslint.config.ts`：

```ts
// apps/server/eslint.config.ts
import nestConfig from '@walnut/eslint-config/nest'

export default nestConfig()
```

目前有本地 `eslint.config.ts` 的是：根、`apps/admin`、`apps/docs`、`apps/e2e`、`apps/server`、`packages/generated/api-types`（前两个用 `vue`、server 用 `nest`、其余用 `base`；两个 base 消费方都带自己的 `ignores`，理由写在各文件顶部）。其余包（platform-any/*、platform-web/*、tooling/*）在 `pnpm lint` 时向上回溯到**根配置**（= `base` 预设）—— 也就是说 `base.ts` 的改动会直接改这些包的 lint 行为。

`types:check` 在本包是真正的类型检查（此前是空跑的 `echo`；现在与全仓其余包一致走 `tsrs --noEmit --pretty`）——预设本身是 TS 源码，写错类型会在 `pnpm types:check` 当场报错。

### 两条本地规则：脚本入口的形态（`script-rules.ts`）

本仓有两条**成文却没有判据**的约定，2026-09-23 把它们做成了本地规则（只在 `**/bin/*.ts` 上生效）：

| 规则 | 判据 | 为什么值得一条规则 |
|------|------|-------------------|
| `walnut-script/script-header` | 第一个语句之前必须有注释（shebang 不算 —— 它每份都一样） | 2026-09-23 立项时实测：当时的 bin 里就有**连文件头都没有**的（那是「约定没有判据」的直接证据）。⚠️ 它只保证「有一段文件头」，**不保证写得好**（bin 里那段模板能过），别当成文档质量门禁 |
| `walnut-script/script-exit-code` | 退出码只能 **0 / 1 / 2 / 3**（四态：通过 / 查出违规 / 前置未满足 / **未验证**） | 这条约定写在多份文档里，此前**没有任何东西在查**。判据落在两个真正的退出口：`process.exit(<数字>)` 与**名为 `main` 的函数**里的 `return <数字>`。3（未验证 = 这一步压根没跑）的规范产生方式是抛 `SkippedError`，`lib/errors.ts` 里的 `SKIPPED_EXIT_CODE` 是唯一真源 |

刻意**不查**的两处（宁可漏报不可误报）：`process.exit(变量)`（判不出取值，而本仓 bin 全是 `process.exit(main())`）、`process.exitCode = N`（那是 `runCli` 的落点 —— 3 就是从这儿出去的，也是合法的信号码出口，比如 SIGINT 会写 130）。`main()` 里**嵌套箭头函数**返回 `-1` 也不算违规 —— 近邻函数判定只看最近的一层。

接这两条规则时顺带补了本包的**第一套测试**（`script-rules.test.ts`，RuleTester 正反语料）：本地规则的失效模式是「悄悄不再命中」，而 lint 全绿看起来永远是对的。

### 3. NestJS 特殊规则放宽容忍

ESLint 的类型感知规则（`ts/no-unsafe-*`）在 NestJS 中做了降级处理（`error` → `warn`）。原因：pnpm workspace symlink 下，TypeScript 的 ESLint 插件无法解析 `@walnut/contract` 中 `as const` 对象的字面类型。`tsc --noEmit` 本身零报错——这些 ESLint 告警是已知误报，见 [ADR-0012](/content/adr/0012-toolchain-divergence.md)。

### 4. 格式化由 oxfmt 承担（ESLint 退出格式职责）

**格式的唯一真源是 oxfmt**（catalog 精确锁 `0.80.0`），ESLint 只留非格式规则：

- 三个预设（`base` / `vue` / `nest`）的 `@antfu/eslint-config` 选项都是 `stylistic: false`，末尾再接 `eslint-config-prettier`（`eslint-config-prettier/flat`）兜底 —— 防止任何残留的格式类规则与 oxfmt 打架。决定沿革见 [ADR 0031](/content/adr/0031-rust-toolchain-migration)（取代 [ADR 0014](/content/adr/0014-eslint-config-strategy) 的格式条款）。
- oxfmt 配置在根 [`.oxfmtrc.json`](https://github.com/walnut-admin/walnut-admin/blob/main/.oxfmtrc.json)：`semi: false` / `singleQuote: true` / `tabWidth: 2` / `printWidth: 100` / `trailingComma: 'all'`。**排序也在这里**（2026-11-28 最终决策）：`sortPackageJson: true`、`sortImports` 全量开启（groups 复刻 antfu 的 perfectionist 配置 + `newlinesBetween: false` + `partitionByNewline: true`）。ESLint 侧因此只关 `perfectionist/sort-imports`，并保留 oxfmt 做不到的三样（`sort-named-imports` / `sort-named-exports` / `sort-exports`）与 `package.json` 的**窄版** `jsonc/sort-keys`（`exports` 条件序 + `resolutions` / `pnpm.overrides` asc；根键序归 oxfmt）。回滚必须成对（`.oxfmtrc.json` 与 `tooling/eslint-config/sort-ownership.ts`）。`*.md` / `*.hbs` 与生成物（`openapi.json` / `packages/generated/api-types/src/schema.d.ts` / `.changeset/ledger.yaml` 等）在 `ignorePatterns` 里不碰。
- 命令：`pnpm walnut format:check`（`oxfmt --check .`）进推送前门禁表的 `format` 段与 CI；本地改完用 `pnpm walnut format:fix`（`oxfmt --write .`），改完仍要再跑一次 check。
- lint-staged 顺序固定为 `oxlint --fix` → `eslint --fix` → `oxfmt --write`：**格式化器收尾**（后跑的工具不得改写前跑工具的输出结构）。`eslint --fix` 会拆 / 合并 import 语句，oxfmt 再按 `sortImports` 重排；反过来（先格式化）时最终文本不满足格式判据，pre-push 的 `format:check` 会红（2026-11-28 实测）。
- **`pnpm lint` 只是 ESLint 一条轨**。完整本地检查 = `pnpm check`（ESLint 轨 + 类型 + 测试 + oxlint 轨 + 格式；= `walnut-check` 的三步表）或 `pnpm prepush`（再多出架构边界、依赖一致性、锁步等）。

没有 `.prettierrc`，也没有独立的 prettier 依赖；`prettier` 不在 catalog（历史上仅作为 `@changesets/cli` 的传递依赖存在，该依赖已随 pnpm 原生发版迁移移除）。

### 5. Git Hooks 门禁

钩子内容的唯一真源是根 `lefthook.yml`（2026-09-23 起由 lefthook 托管，替代 `simple-git-hooks`，见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)）：

```yaml
# lefthook.yml —— 钩子内容进仓库，可被单测审计
pre-commit:
  jobs:
    - name: lint-staged
      run: pnpm exec lint-staged
commit-msg:
  jobs:
    - name: commitlint
      run: pnpm exec commitlint --edit {1}
pre-push:
  jobs:
    - name: prepush-gates
      run: pnpm --silent prepush        # 推送前门禁表（并行），见下
```

staged 文件的匹配规则仍在根 `package.json` 的 `lint-staged` 块（数组形态，**顺序即语义**：**格式化器收尾** —— 后跑的工具不得改写前跑工具的输出结构）。代码与数据文件分成两个**不相交**的 glob（lint-staged 的多个 glob 条目**并行**执行；重叠会 race，同一批 `.ts` 让两个会改文件的工具同时写）：

```jsonc
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,vue,js}": [
      "oxlint --fix",
      "eslint --fix --concurrency=4",
      "oxfmt --write"
    ],
    "*.{json,yml,yaml}": [
      "eslint --fix --concurrency=4",
      "oxfmt --write"
    ]
  }
}
```

`.css` / `.scss` / `.html` 刻意不在 pre-commit 里：没有 fix 链路（postcss / html 无自动修复），由 pre-push 的 `format:check` 兜底。

> 2026-08-08 起：pre-push 增加了 `turbo boundaries`（tag 架构边界检查）；lint-staged 移除了无效的 `*.md` 条目（ESLint preset 关闭 markdown 处理器后该条目静默无效）。
> 2026-09-23 起：钩子改由 lefthook 托管，pre-push 收敛为单条 `pnpm --silent prepush`，并新增 `pnpm walnut hooks:check` 机械核对钩子是否真的装上。
> 2026-09-23 起：仓库级文件全部 `.mjs` → `.ts`，`prepush` 增加 `pnpm walnut lint:root`（glob 从 `*.mjs *.json *.yaml` 改为 `*.ts *.json *.yaml`）——根级配置此前不被任何门禁覆盖；lint-staged 的模式同步改为 `*.{ts,vue,js}`。
> 2026-11-27 起：格式化职责从 ESLint 拆到 oxfmt（三预设 `stylistic: false` + `eslint-config-prettier` 兜底）；推送前门禁表新增 `format` 段（`pnpm walnut format:check`）。
> 2026-11-28 起（R7 收口）：lint-staged 的**顺序改为 `oxlint --fix` → `eslint --fix` → `oxfmt --write`**（原先的「先格式化」会让 `eslint --fix` 的 import 改写逃过格式检查，pre-push 的 `format:check` 红）；glob 扩到 `.tsx` / `.json` / `.yml` / `.yaml`（JSON/YAML 只走 ESLint + oxfmt）。

分层策略：

| 时机 | 做什么 | 耗时 |
|------|--------|------|
| pre-commit | `oxlint --fix` → `eslint --fix` → `oxfmt --write` on staged files | 秒级 |
| commit-msg | commitlint 提交信息规范检查 | 秒级 |
| pre-push | 架构边界 + 根级文件 lint（`pnpm walnut lint:root`）+ 格式检查（`format` 段，`oxfmt --check`）+ 全仓库类型检查 + syncpack 依赖一致性 + actionlint + `pnpm change check`（fixed 组锁步） | 十秒级 |
| CI | boundaries + affected lint/typecheck/test + affected 自检 + syncpack + `pnpm change check` + build | 分钟级 |

## 没做什么 / 为什么

### oxlint / biome 的边界

oxlint 与 biome（Rust 写的极速 linter）对 Vue SFC（`.vue`）的支持仍不完整，所以**都不可能取代 ESLint**。本仓的用法是双轨：**oxlint 进 lint-staged 做第一道快速扫描**（位次在最前，紧跟 `eslint --fix` 与 `oxfmt --write`），Vue 模板、本地规则（`nest-local-rules` / `script-rules`）与类型感知规则继续留在 ESLint。biome 不用。配置形态见迁移评估文档。

#### `eslint-disable` 归属约定

双轨期一条规则**只有一个 owner**（Kibana 的原话是 "each rule runs in exactly one linter"）：
oxlint 已覆盖、ESLint 侧被 `off` 掉的规则，豁免注释写 `oxlint-disable-next-line`；
ESLint 独占的规则（Vue 模板、本地规则、nest 的类型感知与分层、`ts/*` 变体、`unused-imports/*`）
继续写 `eslint-disable*`。写反的后果不是「两边都不报」，而是**非 owner 那侧把指令判成未使用** ——
`eslint --fix` 会直接删掉它，删完 oxlint 立刻报红。

当前有三条规则**刻意留在 ESLint**：`no-control-regex`、`no-empty-pattern`、
`no-misleading-character-class`。现有代码里它们已有带理由的 `eslint-disable-next-line`
（`apps/e2e/tests/fixtures.ts`、`apps/server/apps/api/test/integration/helpers/seed-layer.ts`、
`tooling/eslint-config/comment-rules.ts`）；把 owner 换到 oxlint 会让 ESLint 先删指令、oxlint
随即报红 —— 这是双轨期唯一会「自动修复反而制造失败」的组合。同理，`no-unused-expressions` 与
`no-unused-vars` 的 owner 是 ESLint：它的 `ts/*` / `unused-imports/*` 变体看得见 TS 语义与
`.vue` 模板里的引用，oxlint 只 lint script 块。

### 不用 legacy `.eslintrc`

已全量迁移到 flat config。ESLint v10 将彻底移除对旧格式的支持。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [eslint.config.ts](https://github.com/walnut-admin/walnut-admin/blob/main/eslint.config.ts) | 根入口，委托给 `@walnut/eslint-config/base`；**同时是没有自己配置的包的生效配置**（ESLint 向上查找；包数以 `pnpm-workspace.yaml` 为准，不在这里抄） |
| [tooling/eslint-config/vue.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/vue.ts) | 浏览器 + Vue 预设（admin / docs） |
| [tooling/eslint-config/nest.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/nest.ts) | 后端 NestJS 预设 |
| [tooling/eslint-config/nest-local-rules.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/nest-local-rules.ts) | NestJS 装饰器排序等本地规则插件 |
| [tooling/eslint-config/script-rules.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/script-rules.ts) | 脚本入口的两条本地规则（文件头 / 退出码四态），只作用于 `**/bin/*.ts` |
| [tooling/eslint-config/sort-ownership.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/sort-ownership.ts) | 排序所有权（三个预设共用）：关 `perfectionist/sort-imports`、`package.json` 的窄版 `jsonc/sort-keys` |
| [tooling/eslint-config/base.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/eslint-config/base.ts) | 平台无关基线预设（根入口 + 其余 TS-only 包）；显式开 `pnpm: true` 以保住 catalog 规则 |
| [.oxfmtrc.json](https://github.com/walnut-admin/walnut-admin/blob/main/.oxfmtrc.json) | oxfmt 配置（格式与排序的唯一真源：缩进 / 引号 / 打印宽度 / 尾逗号 / `sortPackageJson` / `sortImports` + `ignorePatterns`） |
| [lefthook.yml](https://github.com/walnut-admin/walnut-admin/blob/main/lefthook.yml) | git 钩子唯一真源（pre-commit / commit-msg / pre-push） |
