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

> 注：以上是**理想约定**，实际并非每个包都齐备——目前有 `test` 脚本的是 server / contract / utils / client / scripts / release（server 的覆盖率脚本叫 `test:cov` 而非 `test:coverage`，utils / client 带 `--passWithNoTests`）；eslint-config / commitlint-config / tsconfig 只有 `lint` / `lint:fix` / `types:check`，没有 `test`（tsconfig 是纯 JSON 预设，`types:check` 只是一句 `echo`）。

### 2. 根 scripts 只做委托

```jsonc
// root package.json — 极薄的一层
{
  "scripts": {
    "dev": "turbo dev --filter=@walnut/admin",  // 默认只启前端
    "dev:all": "turbo dev",                      // 全部启动
    "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "lint": "turbo lint",                        // 各包的 lint 任务
    "lint:root": "eslint *.ts *.json *.yaml",    // 根级文件（配置层）单独一节
    "lint:fix": "turbo lint:fix",
    "types:check": "turbo types:check",
    "types:check:root": "tsc -p tsconfig.json",  // 根级配置（*.ts）的类型检查
    "test": "turbo test",                        // 2026-08-08 补齐
    "clean": "turbo clean",

    // 单包便捷命令（`dev` 本身就等于 dev:admin，重复的那条已删除）
    "dev:server": "turbo dev --filter=@walnut/server",
    "dev:docs": "turbo dev --filter=@walnut/docs",

    // 环境变量加解密（@walnut/scripts 的 bin）
    "setup-env": "walnut-setup-env decrypt",
    "encrypt-env": "walnut-setup-env encrypt",

    // 代码质量
    "knip": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip",
    "knip:packages": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./packages/*/*",
    "knip:apps": "cross-env NODE_OPTIONS=--max-old-space-size=8192 knip --workspace ./apps/*",
    "syncpack:lint": "syncpack lint --dependency-types dev,prod",
    "syncpack:fix": "syncpack fix",
    "lint:workflows": "walnut-lint-workflows",   // actionlint 校验 .github/workflows
    "lint:docs-refs": "walnut-check-doc-refs",   // 校验活文档正文引用的包名 / 仓库路径
    "hooks:check": "walnut-check-git-hooks",     // 断言 git 钩子由 lefthook 托管

    // pre-push 的聚合门禁（lefthook 的 pre-push 只调这一条，八段按序跑）
    "prepush": "pnpm boundaries && pnpm lint:root && pnpm types:check && pnpm types:check:root && pnpm syncpack:lint && pnpm lint:workflows && pnpm lint:docs-refs && pnpm change check",

    // 发布（@walnut/release 的 bin，实现位于 packages/tooling/release/src/release/）
    "release": "walnut-release"
  }
}
```

根 scripts 里的 `NODE_OPTIONS=` 前缀统一用 `cross-env` 包裹（Windows 兼容）。早期的 `tsx scripts/*.ts` 写法已消失：仓库级脚本拆在 `packages/tooling/scripts/`（通用层 + 4 个 bin）与 `packages/tooling/release/`（发版编排 + `walnut-release`），根 `scripts/` 目录不存在，根 scripts 只经 bin 调用（`walnut-release` / `walnut-lint-workflows` / `walnut-setup-env` / `walnut-check-git-hooks` / `walnut-check-doc-refs`）。也没有 `changeset` / `changeset:auto` / `changelog` 脚本——版本意图由 `pnpm change` 写、`pnpm version -r` 消费（见 [发布 & 发版指南](./release.md)）。

> `tsx` 已**完全移出仓库**（不只是根 scripts）：仓内最后一个使用者是 `apps/admin` 的 `predev`（`node build/generate/genJSONSchemas.ts`）与 `types:check:log`（`node build/types.ts`），两个脚本改走 Node 24 原生类型剥离后，`tsx` 的 devDependency 与 catalog 条目一起删掉。代价是这两条链路要满足 Node ESM 的解析规则：`build/utils/**` 的相对导入补全 `.ts` 扩展名，`build/utils/log.ts` 的 `import pkg from '../../package.json'` 补 `with { type: 'json' }` 导入属性。

> `lint:root` 是 2026-09-23 新增的一节（glob 从 `*.mjs` 改为 `*.ts`）。根级配置（`eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts` / `package.json` / `pnpm-workspace.yaml`）此前**不被任何门禁覆盖**——`pnpm lint` 只跑各包的 `lint` 任务。它现在进 `prepush` 与发版电池，`ci.yml` 的 quality job 也补了一步 `pnpm lint:root`（它不进 turbo 的 affected 图，所以必须显式跑）。

**关键规则**：根 scripts 不包含构建逻辑。`turbo build` 会找到所有包的 `build` script 并按拓扑顺序执行。

### 3. 按包类型的差异化

| 包类型 | build | types:check | dev |
|--------|-------|-----------|-----|
| Vue 应用 (`@walnut/admin`) | `vite build` | `vue-tsc --noEmit` | `vite` |
| 文档站 (`@walnut/docs`) | `vitepress build` | `echo skipped` | `vitepress` |
| NestJS (`@walnut/server`) | `nest build`（SWC，按 `infra/nest/*.json`） | `tsc --noEmit` | `nest start api --watch` |
| 平台无关包 (`@walnut/utils`、`@walnut/contract`) | `vite build`（产出 CJS dist；contract 之后还跑 `node scripts/build-barrel.ts`） | `tsc --noEmit` | 无 `dev` 脚本 |
| 源码直消费 (`@walnut/client`、`@walnut/http`、`@walnut/ui`、`@walnut/types`) | 不构建（`echo` 占位） | `tsc --noEmit`（`ui` 用 `vue-tsc`） | 无 `dev` 脚本 |
| 工具链包 (`@walnut/scripts`、`@walnut/release`、`@walnut/eslint-config`、`@walnut/commitlint-config`、`@walnut/vitest-config`) | 无 | `tsc --noEmit` | 无 `dev` 脚本 |
| `@walnut/tsconfig` | 无（纯 JSON 预设） | `echo`（无源码可查） | 无 `dev` 脚本 |

前端构建的特殊性：admin 的 `build` 就是纯 `vite build`（不再含 `vue-tsc`，Vite 构建本身不做类型检查），类型检查由独立的 `types:check` 任务（`vue-tsc --noEmit`）承担。docs 的 `types:check` 是 `echo skipped`（文档站没有需要类型检查的 TS 逻辑）。**没有 `build` 产物的包不是"漏了脚本"**：它们的 `build` 是一句 `echo` 占位，只为让 turbo 的 `build` 任务拓扑（`dependsOn: ["^build"]`）在整图上成立。

### 4. Git Hooks

钩子内容的唯一真源是根 `lefthook.yml`（lefthook，不再是 `simple-git-hooks`，见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)）：

```
pre-commit → pnpm exec lint-staged（ESLint fix on staged files，秒级）
commit-msg → pnpm exec commitlint --edit {1}（提交信息规范检查）
pre-push   → pnpm --silent prepush（单条聚合门禁：八段按序跑，十秒级）
```

`prepush` = `pnpm boundaries && pnpm lint:root && pnpm types:check && pnpm syncpack:lint && pnpm lint:workflows && pnpm change check`
（架构边界 + **根级文件 lint** + 类型检查 + 依赖一致性 + actionlint + fixed 组版本锁步）。

`pre-commit` 只跑 ESLint fix，不做类型检查（太慢，阻塞 commit 体验）；`commit-msg` 由 commitlint 校验提交信息格式；架构边界（`turbo boundaries`）、根级文件 lint（`pnpm lint:root`）、类型检查、syncpack 依赖一致性、workflow 校验与版本锁步都放在 `pre-push`。pre-push 刻意收敛成**单条命令**：被截断时只会退化成"命令不存在"，响亮报错，而不是"语法合法但少跑几项"的静默弱化。

> 注意 `pnpm lint:root` 是根 `package.json` 里的**普通脚本**，不是 turbo 任务（根 `turbo.json` 的 `tasks` 里没有 `lint:root`）。因此它只能经 `pnpm` 调用——`turbo run lint:root` 会直接报 `Could not find task 'lint:root' in project`。

## 没做什么 / 为什么

### 不写 mega-scripts

不在根 package.json 写复杂的 shell 脚本。所有跨包编排由 Turbo 处理，所有仓库级脚本（门禁、env 加解密、发版编排）由 `@walnut/scripts`（`packages/tooling/scripts/`，4 个 bin）与 `@walnut/release`（`packages/tooling/release/`，bin `walnut-release`）提供。根 scripts 保持"一句话委托"。

### 不用 `concurrently` 编排

`concurrently` 只能并行启动进程，不理解依赖拓扑。`turbo dev` 不仅并行启动，还按依赖顺序执行（先启动被依赖的包，再启动依赖者），避免"依赖还没准备好就请求"的问题。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [package.json](https://github.com/walnut-admin/walnut-admin/blob/main/package.json) | 根 scripts，全为委托 |
| [packages/tooling/scripts/](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/scripts) | `@walnut/scripts`——4 个 bin（`walnut-lint-workflows` / `walnut-setup-env` / `walnut-check-git-hooks` / `walnut-check-doc-refs`） |
| [packages/tooling/vitest-config/](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/vitest-config) | `@walnut/vitest-config`——共享 Vitest 预设（无 bin、无 build） |
| [packages/tooling/release/](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/release) | `@walnut/release`——bin `walnut-release`（根 `pnpm release`） |
| [apps/admin/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/admin/package.json) | 前端 scripts（Vite） |
| [apps/server/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/server/package.json) | 后端 scripts（NestJS CLI + SWC） |
