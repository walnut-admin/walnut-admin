# ESLint 配置

## 概述

Walnut Admin 使用 **ESLint 10.3 flat config** + `@antfu/eslint-config` 作为统一的代码检查方案。配置通过 `@walnut/eslint-config` 共享包分发给所有 workspace 成员。

## 我们做了什么

### 1. Flat Config 迁移

ESLint v9+ 默认只支持 flat config（`eslint.config.ts`）。旧的 `.eslintrc.*` 格式已被废弃。项目已完成全量迁移：

```ts
// root eslint.config.ts — 全仓库入口
import baseConfig from '@walnut/eslint-config/base'

export default baseConfig()
```

> ⚠️ 这个文件的作用域**不止根目录**：仓内只有 5 份 `eslint.config.ts`（根 + 3 个 app + ui），
> 其余 10 个包（`platform-any/*`、`platform-web/{client,http}`、`tooling/*`）没有自己的配置，
> ESLint 会**向上查到本文件** —— 它们全是 TS-only（零 `.vue`），`base` 正是它们该用的预设。
> 2026-09-23 之前根入口用的是 `vue` 预设，等于给这 10 个包白装了 vue / unocss 插件。

> 2026-09-23 起，仓库里**没有任何 `.mjs` / `.cjs` 文件**：4 个包级 ESLint 配置、`eslint-config` 的 4 个文件（3 个预设 + 本地规则插件 `nest-local-rules`）、commitlint 配置与 config 包、`@walnut/scripts` 的 `bin/` 下那批脚本（当时 5 个，此后还在加）、contract 的 `build-barrel` 脚本全部改成 `.ts`。ESLint 加载 `eslint.config.ts` 需要 **`jiti`**（ESLint 官方的 TS 配置加载器），因此根 `devDependencies` 新增了它。详见 [ADR-0019](/content/adr/0019-tsconfig-presets-and-no-mjs)。

### 2. 共享 ESLint Config 包

[`@walnut/eslint-config`](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/eslint-config) 提供三种预设：

| 预设 | 文件 | 适用场景 |
|------|------|---------|
| `vue` | `vue.ts` | `apps/admin`、`apps/docs`、`packages/platform-web/*`——Vue 3 + TypeScript（+ UnoCSS） |
| `nest` | `nest.ts` | `apps/server`——NestJS + CJS + decorators（带本地装饰器排序规则 `nest-local-rules.ts`） |
| `base` | `base.ts` | **根 `eslint.config.ts`**（因此也是那 10 个没有自己配置的包的预设）；纯平台无关基线（不开 Vue / UnoCSS）+ 两条脚本入口规则 `script-rules.ts` |

各消费者在包根写一行 `eslint.config.ts`：

```ts
// apps/server/eslint.config.ts
import nestConfig from '@walnut/eslint-config/nest'

export default nestConfig()
```

目前有本地 `eslint.config.ts` 的是：根、`apps/admin`、`apps/docs`、`apps/server`、`packages/platform-web/ui`（唯一一个有本地配置的包）。其余包（platform-any/*、platform-web/{client,http}、tooling/*）在 `pnpm lint` 时向上回溯到**根配置**（= `base` 预设）—— 也就是说 `base.ts` 的改动会直接改这 10 个包的 lint 行为。

`types:check` 在本包是真正的 `tsc --noEmit`（此前是空跑的 `echo`）——预设本身是 TS 源码，写错类型会在 `pnpm types:check` 当场报错。

### 两条本地规则：脚本入口的形态（`script-rules.ts`）

本仓有两条**成文却没有判据**的约定，2026-09-23 把它们做成了本地规则（只在 `**/bin/*.ts` 上生效）：

| 规则 | 判据 | 为什么值得一条规则 |
|------|------|-------------------|
| `walnut-script/script-header` | 第一个语句之前必须有注释（shebang 不算 —— 它每份都一样） | 实测 13 个 bin 里有 **2 个连文件头都没有**。⚠️ 它只保证「有一段文件头」，**不保证写得好**（bin 里那段模板能过），别当成文档质量门禁 |
| `walnut-script/script-exit-code` | 退出码只能 **0 / 1 / 2**（三态：通过 / 查出违规 / 前置条件未满足） | 这条约定写在多份文档里，此前**没有任何东西在查**。判据落在两个真正的退出口：`process.exit(<数字>)` 与**名为 `main` 的函数**里的 `return <数字>` |

刻意**不查**的两处（宁可漏报不可误报）：`process.exit(变量)`（判不出取值，而本仓 bin 全是 `process.exit(main())`）、`process.exitCode = N`（那是合法的信号码出口，比如 SIGINT 会写 130）。`main()` 里**嵌套箭头函数**返回 `-1` 也不算违规 —— 近邻函数判定只看最近的一层。

接这两条规则时顺带补了本包的**第一套测试**（`script-rules.test.ts`，RuleTester 正反语料）：本地规则的失效模式是「悄悄不再命中」，而 lint 全绿看起来永远是对的。

### 3. NestJS 特殊规则放宽容忍

ESLint 的类型感知规则（`ts/no-unsafe-*`）在 NestJS 中做了降级处理（`error` → `warn`）。原因：pnpm workspace symlink 下，TypeScript 的 ESLint 插件无法解析 `@walnut/contract` 中 `as const` 对象的字面类型。`tsc --noEmit` 本身零报错——这些 ESLint 告警是已知误报，见 [ADR-0012](/content/adr/0012-toolchain-divergence.md)。

### 4. 格式化由 ESLint 承担

项目不使用 Prettier：没有 `.prettierrc`、没有 `eslint-config-prettier`、没有 `format` 脚本，`prettier` 也不在 catalog（此前仅作为 `@changesets/cli` 的传递依赖存在，该依赖已随 pnpm 原生发版迁移移除）。格式化规则由 ESLint（`@antfu/eslint-config` 内置的 stylistic 规则）统一承担，`lint:fix` 和 lint-staged 就是格式化入口。

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

staged 文件的匹配规则仍在根 `package.json` 的 `lint-staged` 块：

```jsonc
// package.json
{
  "lint-staged": {
    "*.{ts,vue,js}": "eslint --fix --concurrency=auto"
  }
}
```

> 2026-08-08 起：pre-push 增加了 `turbo boundaries`（tag 架构边界检查）；lint-staged 移除了无效的 `*.md` 条目（ESLint preset 关闭 markdown 处理器后该条目静默无效）。
> 2026-09-23 起：钩子改由 lefthook 托管，pre-push 收敛为单条 `pnpm --silent prepush`，并新增 `pnpm hooks:check` 机械核对钩子是否真的装上。
> 2026-09-23 起：仓库级文件全部 `.mjs` → `.ts`，`prepush` 增加 `pnpm lint:root`（glob 从 `*.mjs *.json *.yaml` 改为 `*.ts *.json *.yaml`）——根级配置此前不被任何门禁覆盖；lint-staged 的模式同步改为 `*.{ts,vue,js}`。

分层策略：

| 时机 | 做什么 | 耗时 |
|------|--------|------|
| pre-commit | ESLint fix on staged files | 秒级 |
| commit-msg | commitlint 提交信息规范检查 | 秒级 |
| pre-push | 架构边界 + 根级文件 lint（`pnpm lint:root`）+ 全仓库类型检查 + syncpack 依赖一致性 + actionlint + `pnpm change check`（fixed 组锁步） | 十秒级 |
| CI | boundaries + affected lint/typecheck/test + affected 自检 + syncpack + `pnpm change check` + build | 分钟级 |

## 没做什么 / 为什么

### 不用 oxlint / biome

oxlint 和 biome（Rust 写的极速 linter）都不支持 Vue SFC（`.vue` 文件）。Walnut Admin 的前端是 Vue 3，这是 blocker。将来如果它们支持 Vue SFC，可以作为 ESLint 之前的第一道快速扫描层。

### 不用 legacy `.eslintrc`

已全量迁移到 flat config。ESLint v10 将彻底移除对旧格式的支持。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [eslint.config.ts](https://github.com/walnut-admin/walnut-admin/blob/main/eslint.config.ts) | 根入口，委托给 `@walnut/eslint-config/base`；**同时是 10 个没有自己配置的包的生效配置**（ESLint 向上查找） |
| [packages/tooling/eslint-config/vue.ts](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/vue.ts) | 浏览器 + Vue 预设（admin / docs / ui） |
| [packages/tooling/eslint-config/nest.ts](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/nest.ts) | 后端 NestJS 预设 |
| [packages/tooling/eslint-config/nest-local-rules.ts](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/nest-local-rules.ts) | NestJS 装饰器排序等本地规则插件 |
| [packages/tooling/eslint-config/script-rules.ts](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/script-rules.ts) | 脚本入口的两条本地规则（文件头 / 退出码三态），只作用于 `**/bin/*.ts` |
| [packages/tooling/eslint-config/base.ts](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/base.ts) | 平台无关基线预设（根入口 + 10 个 TS-only 包）；显式开 `pnpm: true` 以保住 catalog 规则 |
| [lefthook.yml](https://github.com/walnut-admin/walnut-admin/blob/main/lefthook.yml) | git 钩子唯一真源（pre-commit / commit-msg / pre-push） |
