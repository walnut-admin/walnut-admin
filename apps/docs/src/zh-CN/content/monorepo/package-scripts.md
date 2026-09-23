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

> 注：以上是**理想约定**，实际并非每个包都齐备——目前有 `test` 脚本的是 server / contract / utils / client / tooling（server 的覆盖率脚本叫 `test:cov` 而非 `test:coverage`，utils / client 带 `--passWithNoTests`）；eslint-config 只有 `lint` / `lint:fix` / `types:check`，没有 `test`。

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

    // 环境变量加解密（@walnut/tooling 的 bin）
    "setup-env": "walnut-setup-env decrypt",
    "encrypt-env": "walnut-setup-env encrypt",

    // 代码质量
    "knip": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip",
    "knip:packages": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./packages/*/*",
    "knip:apps": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./apps/*",
    "syncpack:lint": "syncpack lint --dependency-types dev,prod",
    "syncpack:fix": "syncpack fix",
    "lint:workflows": "walnut-lint-workflows",   // actionlint 校验 .github/workflows
    "hooks:check": "walnut-check-git-hooks",     // 断言 git 钩子由 lefthook 托管

    // pre-push 的聚合门禁（lefthook 的 pre-push 只调这一条）
    "prepush": "pnpm boundaries && pnpm types:check && pnpm syncpack:lint && pnpm lint:workflows && pnpm change check",

    // 发布（@walnut/tooling 的 bin，实现位于 packages/tooling/scripts/src/release/）
    "release": "walnut-release"
  }
}
```

根 scripts 里的 `NODE_OPTIONS=` 前缀统一用 `cross-env` 包裹（Windows 兼容）。早期的 `tsx scripts/*.ts` 写法已消失：仓库级脚本全部收进 `packages/tooling/scripts/`，根 `scripts/` 目录不存在，根 scripts 只经 bin 调用（`walnut-release` / `walnut-lint-workflows` / `walnut-setup-env` / `walnut-check-git-hooks`）。也没有 `changeset` / `changeset:auto` / `changelog` 脚本——版本意图由 `pnpm change` 写、`pnpm version -r` 消费（见 [发布 & 发版指南](./release.md)）。

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

钩子内容的唯一真源是根 `lefthook.yml`（lefthook，不再是 `simple-git-hooks`，见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)）：

```
pre-commit → pnpm exec lint-staged（ESLint fix on staged files，秒级）
commit-msg → pnpm exec commitlint --edit {1}（提交信息规范检查）
pre-push   → pnpm --silent prepush（单条聚合门禁：五段按序跑，十秒级）
```

`prepush` = `pnpm boundaries && pnpm types:check && pnpm syncpack:lint && pnpm lint:workflows && pnpm change check`
（架构边界 + 类型检查 + 依赖一致性 + actionlint + fixed 组版本锁步）。

`pre-commit` 只跑 ESLint fix，不做类型检查（太慢，阻塞 commit 体验）；`commit-msg` 由 commitlint 校验提交信息格式；架构边界（`turbo boundaries`）、类型检查、syncpack 依赖一致性、workflow 校验与版本锁步都放在 `pre-push`。pre-push 刻意收敛成**单条命令**：被截断时只会退化成"命令不存在"，响亮报错，而不是"语法合法但少跑几项"的静默弱化。

## 没做什么 / 为什么

### 不写 mega-scripts

不在根 package.json 写复杂的 shell 脚本。所有跨包编排由 Turbo 处理，所有仓库级脚本（发版编排、门禁、env 加解密）由 `@walnut/tooling`（`packages/tooling/scripts/`）的 bin 处理。根 scripts 保持"一句话委托"。

### 不用 `concurrently` 编排

`concurrently` 只能并行启动进程，不理解依赖拓扑。`turbo dev` 不仅并行启动，还按依赖顺序执行（先启动被依赖的包，再启动依赖者），避免"依赖还没准备好就请求"的问题。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [package.json](https://github.com/walnut-admin/walnut-admin/blob/main/package.json) | 根 scripts，全为委托 |
| [apps/admin/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/admin/package.json) | 前端 scripts（Vite） |
| [apps/server/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/server/package.json) | 后端 scripts（NestJS CLI + SWC） |
