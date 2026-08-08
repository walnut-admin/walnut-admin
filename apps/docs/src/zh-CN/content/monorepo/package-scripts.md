# package.json & Scripts

## 概述

Walnut Admin 的 `package.json` 遵循一套严格的脚本约定：**每个 workspace 包都有相同的 script 名称，根 scripts 只做委托**。这套约定让 Turborepo 能统一编排所有包的任务。

## 我们做了什么

### 1. 标准化 script 名称

每个包至少包含以下 scripts（名称一致）：

```jsonc
{
  "scripts": {
    "build": "tsc",              // 构建产物
    "dev": "tsc --watch",        // 开发模式
    "clean": "rm -rf dist",      // 清理
    "typecheck": "tsc --noEmit", // 纯类型检查（不产出文件）
    "lint": "eslint src/",       // 代码检查
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",        // 单次测试
    "test:watch": "vitest",      // 持续测试
    "test:coverage": "vitest run --coverage"
  }
}
```

**一致性 > 自由度**。不要有的包叫 `lint`，有的叫 `eslint`——Turbo 需要统一的 task 名来编排。

> 注：以上是**理想约定**，实际并非每个包都齐备——目前有 `test` 脚本的是 server / utils / client / release（server 的覆盖率脚本叫 `test:cov` 而非 `test:coverage`）；eslint-config 则没有任何 scripts。

### 2. 根 scripts 只做委托

```jsonc
// root package.json — 极薄的一层
{
  "scripts": {
    "dev": "turbo dev --filter=@walnut/admin",  // 默认只启前端
    "dev:all": "turbo dev",                      // 全部启动
    "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "types:check": "turbo types:check",
    "test": "turbo test",                        // 2026-08-08 补齐
    "clean": "turbo clean",

    // 单包便捷命令
    "dev:admin": "turbo dev --filter=@walnut/admin",
    "dev:server": "turbo dev --filter=@walnut/server",
    "dev:docs": "turbo dev --filter=@walnut/docs",

    // 环境变量加解密
    "setup-env": "tsx scripts/setup-env.ts decrypt",
    "encrypt-env": "tsx scripts/setup-env.ts encrypt",

    // 代码质量
    "knip": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip",
    "knip:packages": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./packages/*/*",
    "knip:apps": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./apps/*",
    "syncpack:lint": "syncpack lint --dependency-types dev,prod",
    "syncpack:fix": "syncpack fix",

    // 发布（@walnut/release 包的 bin，实现位于 packages/tooling/release/）
    "release": "walnut-release"
  }
}
```

根 scripts 里的 `NODE_OPTIONS=` 前缀统一用 `cross-env` 包裹（Windows 兼容）。不再有 `changeset` / `changeset:auto` / `changelog` 脚本——git-cliff 已移除，`scripts/version/` 目录不存在，发布逻辑全部收敛到 `@walnut/release` 包。

**关键规则**：根 scripts 不包含构建逻辑。`turbo build` 会找到所有包的 `build` script 并按拓扑顺序执行。

### 3. 按包类型的差异化

| 包类型 | build | typecheck | dev |
|--------|-------|-----------|-----|
| Vue 应用 (`@walnut/admin`) | `vite build` | `vue-tsc --noEmit` | `vite` |
| NestJS (`@walnut/server`) | `nest build` (SWC) | `tsc --noEmit` | `nest start --watch` |
| 纯 TS 包 (`@walnut/utils`) | `tsc` | `tsc --noEmit` | `tsc --watch` |
| 源码消费 (`@walnut/client`) | 不构建 | `tsc --noEmit` | — |

前端构建的特殊性：admin 的 `build` 就是纯 `vite build`（不再含 `vue-tsc`，Vite 构建本身不做类型检查），类型检查由独立的 `types:check` 任务（`vue-tsc --noEmit`）承担。docs 的 `types:check` 是 `echo skipped`（文档站没有需要类型检查的 TS 逻辑）。

### 4. Git Hooks

```
pre-commit → lint-staged（ESLint fix on staged files，秒级）
commit-msg → commitlint（提交信息规范检查）
pre-push   → pnpm types:check && pnpm syncpack:lint（类型检查 + 依赖一致性，十秒级）
```

`pre-commit` 只跑 ESLint fix，不做类型检查（太慢，阻塞 commit 体验）；`commit-msg` 由 commitlint 校验提交信息格式；类型检查和 syncpack 依赖一致性检查放在 `pre-push`。

## 没做什么 / 为什么

### 不写 mega-scripts

不在根 package.json 写复杂的 shell 脚本。所有跨包编排由 Turbo 处理，所有发布逻辑由 `@walnut/release` 包（`packages/tooling/release/`）的 bin 处理。根 scripts 保持"一句话委托"。

### 不用 `concurrently` 编排

`concurrently` 只能并行启动进程，不理解依赖拓扑。`turbo dev` 不仅并行启动，还按依赖顺序执行（先启动被依赖的包，再启动依赖者），避免"依赖还没准备好就请求"的问题。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [package.json](https://github.com/walnut-admin/walnut-admin/blob/main/package.json) | 根 scripts，全为委托 |
| [apps/admin/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/admin/package.json) | 前端 scripts（Vite） |
| [apps/server/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/server/package.json) | 后端 scripts（NestJS CLI + SWC） |
