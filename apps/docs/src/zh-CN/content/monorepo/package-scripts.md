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

### 2. 根 scripts 只做委托

```jsonc
// root package.json — 极薄的一层
{
  "scripts": {
    "dev": "turbo dev --filter=@walnut/admin",  // 默认只启前端
    "dev:all": "turbo dev",                      // 全部启动
    "build": "NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "types:check": "turbo types:check",
    "test": "turbo test",
    "clean": "turbo clean",

    // 全局命令（不走 turbo，因为有副作用）
    "format": "prettier --write .",
    "format:check": "prettier --check .",

    // 单包便捷命令
    "dev:admin": "pnpm --filter @walnut/admin dev",
    "dev:server": "pnpm --filter @walnut/server dev",
    "dev:docs": "pnpm --filter @walnut/docs dev",

    // 发布
    "changeset": "changeset",
    "changeset:auto": "tsx scripts/version/auto-changeset.ts",
    "release": "tsx scripts/version/release.ts",
    "changelog": "git-cliff -o CHANGELOG.md",

    // 代码质量
    "knip": "knip",
    "knip:packages": "knip --workspace packages/*"
  }
}
```

**关键规则**：根 scripts 不包含构建逻辑。`turbo build` 会找到所有包的 `build` script 并按拓扑顺序执行。

### 3. 按包类型的差异化

| 包类型 | build | typecheck | dev |
|--------|-------|-----------|-----|
| Vue 应用 (`@walnut/admin`) | `vue-tsc --noEmit && vite build` | `vue-tsc --noEmit` | `vite --port 3100` |
| NestJS (`@walnut/server`) | `nest build` (SWC) | `tsc --noEmit` | `nest start --watch` |
| 纯 TS 包 (`@walnut/utils`) | `tsc` | `tsc --noEmit` | `tsc --watch` |
| 源码消费 (`@walnut/client`) | 不构建 | `tsc --noEmit` | — |

前端构建的特殊性：`vue-tsc --noEmit` 在 build 阶段跑一次类型检查（Vite 构建本身不做类型检查）。日常开发的类型检查通过 `pnpm types:check`（`turbo types:check`）来做。

### 4. Git Hooks

```
pre-commit → lint-staged（ESLint fix on staged files，秒级）
pre-push   → pnpm types:check（全仓库类型检查，十秒级）
```

`pre-commit` 只跑 ESLint fix，不做类型检查（太慢，阻塞 commit 体验）。类型检查放在 `pre-push`。

## 没做什么 / 为什么

### 不写 mega-scripts

不在根 package.json 写复杂的 shell 脚本。所有跨包编排由 Turbo 处理，所有发布逻辑由 `scripts/version/` 下的 TS 文件处理。根 scripts 保持"一句话委托"。

### 不用 `concurrently` 编排

`concurrently` 只能并行启动进程，不理解依赖拓扑。`turbo dev` 不仅并行启动，还按依赖顺序执行（先启动被依赖的包，再启动依赖者），避免"依赖还没准备好就请求"的问题。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [package.json](https://github.com/walnut-admin/walnut-admin-client/blob/main/package.json) | 根 scripts，全为委托 |
| [apps/admin/package.json](https://github.com/walnut-admin/walnut-admin-client/blob/main/apps/admin/package.json) | 前端 scripts（Vite + vue-tsc） |
| [apps/server/package.json](https://github.com/walnut-admin/walnut-admin-client/blob/main/apps/server/package.json) | 后端 scripts（NestJS CLI + SWC） |
