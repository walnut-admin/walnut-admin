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

[`@walnut/eslint-config`](https://github.com/walnut-admin/walnut-admin-client/tree/main/packages/eslint-config) 提供三种预设：

| 预设 | 文件 | 适用场景 |
|------|------|---------|
| `vue` | `vue.mjs` | `apps/admin` — Vue 3 + TypeScript |
| `nest` | `nest.mjs` | `apps/server` — NestJS + CJS + decorators |
| `base` | `base.mjs` | `packages/*` — 纯 TypeScript 共享包 |

每个消费者只需一行 import：

```js
import nestConfig from '@walnut/eslint-config/nest'
export default nestConfig()
```

### 3. NestJS 特殊规则放宽容忍

ESLint 的类型感知规则（`ts/no-unsafe-*`）在 NestJS 中做了降级处理（`error` → `warn`）。原因：pnpm workspace symlink 下，TypeScript 的 ESLint 插件无法解析 `@walnut/contract` 中 `as const` 对象的字面类型。`tsc --noEmit` 本身零报错——这些 ESLint 告警是已知误报，见 [ADR-0012](/content/adr/0012-toolchain-divergence.md)。

### 4. Prettier 集成

根目录统一管理 `.prettierrc`，通过 `eslint-config-prettier` 关闭 ESLint 中与 Prettier 冲突的格式规则。`prettier` 是 catalog 统一版本。

### 5. Git Hooks 门禁

```jsonc
// package.json
{
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged",
    "pre-push": "pnpm types:check"    // pre-push 才跑类型检查（慢）
  },
  "lint-staged": {
    "*.{ts,vue,mjs,js}": "eslint --fix --concurrency=auto",
    "*.md": "eslint --fix"
  }
}
```

分层策略：

| 时机 | 做什么 | 耗时 |
|------|--------|------|
| pre-commit | ESLint fix on staged files | 秒级 |
| pre-push | 全仓库类型检查 | 十秒级 |
| CI | 完整 lint + typecheck + test | 分钟级 |

## 没做什么 / 为什么

### 不用 oxlint / biome

oxlint 和 biome（Rust 写的极速 linter）都不支持 Vue SFC（`.vue` 文件）。Walnut Admin 的前端是 Vue 3，这是 blocker。将来如果它们支持 Vue SFC，可以作为 ESLint 之前的第一道快速扫描层。

### 不用 legacy `.eslintrc`

已全量迁移到 flat config。ESLint v10 将彻底移除对旧格式的支持。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [eslint.config.mjs](https://github.com/walnut-admin/walnut-admin-client/blob/main/eslint.config.mjs) | 根入口，委托给 `@walnut/eslint-config/vue` |
| [packages/eslint-config/vue.mjs](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/eslint-config/vue.mjs) | 前端 Vue 3 预设 |
| [packages/eslint-config/nest.mjs](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/eslint-config/nest.mjs) | 后端 NestJS 预设 |
| [packages/eslint-config/base.mjs](https://github.com/walnut-admin/walnut-admin-client/blob/main/packages/eslint-config/base.mjs) | 共享包预设 |
| [.prettierrc](https://github.com/walnut-admin/walnut-admin-client/blob/main/.prettierrc) | 格式化统一配置 |
