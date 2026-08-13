# ESLint 配置

## 概述

Walnut Admin 使用 **ESLint 10.3 flat config** + `@antfu/eslint-config` 作为统一的代码检查方案。配置通过 `@walnut/eslint-config` 共享包分发给所有 workspace 成员。

## 我们做了什么

### 1. Flat Config 迁移

ESLint v9+ 默认只支持 flat config（`eslint.config.mjs`）。旧的 `.eslintrc.*` 格式已被废弃。项目已完成全量迁移：

```js
// root eslint.config.mjs — 全仓库入口
import vueConfig from '@walnut/eslint-config/vue'
export default vueConfig()
```

### 2. 共享 ESLint Config 包

[`@walnut/eslint-config`](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/eslint-config) 提供三种预设：

| 预设 | 文件 | 适用场景 |
|------|------|---------|
| `vue` | `vue.mjs` | `apps/admin` — Vue 3 + TypeScript |
| `nest` | `nest.mjs` | `apps/server` — NestJS + CJS + decorators |
| `base` | `base.mjs` | 目前无直接消费者——共享包没有本地 `eslint.config.mjs`，lint 时向上回溯到根 `vue` 预设 |

每个消费者只需一行 import：

```js
import nestConfig from '@walnut/eslint-config/nest'
export default nestConfig()
```

### 3. NestJS 特殊规则放宽容忍

ESLint 的类型感知规则（`ts/no-unsafe-*`）在 NestJS 中做了降级处理（`error` → `warn`）。原因：pnpm workspace symlink 下，TypeScript 的 ESLint 插件无法解析 `@walnut/contract` 中 `as const` 对象的字面类型。`tsc --noEmit` 本身零报错——这些 ESLint 告警是已知误报，见 [ADR-0012](/content/adr/0012-toolchain-divergence.md)。

### 4. 格式化由 ESLint 承担

项目不使用 Prettier：没有 `.prettierrc`、没有 `eslint-config-prettier`、没有 `format` 脚本，`prettier` 也不在 catalog（仅作为 `@changesets` 的传递依赖存在）。格式化规则由 ESLint（`@antfu/eslint-config` 内置的 stylistic 规则）统一承担，`lint:fix` 和 lint-staged 就是格式化入口。

### 5. Git Hooks 门禁

```jsonc
// package.json
{
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged",
    "commit-msg": "pnpm commitlint --edit $1",
    "pre-push": "pnpm boundaries && pnpm types:check && pnpm syncpack:lint"   // 架构边界 + 类型检查 + 依赖一致性
  },
  "lint-staged": {
    "*.{ts,vue,mjs,js}": "eslint --fix --concurrency=auto"
  }
}
```

> 2026-08-08 起：pre-push 增加了 `turbo boundaries`（tag 架构边界检查）；lint-staged 移除了无效的 `*.md` 条目（ESLint preset 关闭 markdown 处理器后该条目静默无效）。

分层策略：

| 时机 | 做什么 | 耗时 |
|------|--------|------|
| pre-commit | ESLint fix on staged files | 秒级 |
| commit-msg | commitlint 提交信息规范检查 | 秒级 |
| pre-push | 架构边界 + 全仓库类型检查 + syncpack 依赖一致性 | 十秒级 |
| CI | boundaries + affected lint/typecheck/test + syncpack + build | 分钟级 |

## 没做什么 / 为什么

### 不用 oxlint / biome

oxlint 和 biome（Rust 写的极速 linter）都不支持 Vue SFC（`.vue` 文件）。Walnut Admin 的前端是 Vue 3，这是 blocker。将来如果它们支持 Vue SFC，可以作为 ESLint 之前的第一道快速扫描层。

### 不用 legacy `.eslintrc`

已全量迁移到 flat config。ESLint v10 将彻底移除对旧格式的支持。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [eslint.config.mjs](https://github.com/walnut-admin/walnut-admin/blob/main/eslint.config.mjs) | 根入口，委托给 `@walnut/eslint-config/vue` |
| [packages/tooling/eslint-config/vue.mjs](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/vue.mjs) | 前端 Vue 3 预设 |
| [packages/tooling/eslint-config/nest.mjs](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/nest.mjs) | 后端 NestJS 预设 |
| [packages/tooling/eslint-config/base.mjs](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/base.mjs) | 共享包预设（当前无直接消费者） |
