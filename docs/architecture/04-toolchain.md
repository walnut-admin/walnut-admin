# 04 · 工具链

> 本文件详述 monorepo 的工具链架构：pnpm catalog、Turborepo 任务图、git hooks、ESLint。
> TypeScript 配置策略单列在 [05-tsconfig-strategy.md](./05-tsconfig-strategy.md)。

---

## 1. 包管理器：pnpm + catalog

### 1.1 版本与强制

- `packageManager: pnpm@11.13.0`（Corepack 锁定，见根 `package.json`）
- `engines`: `node >=24.13.0`, `pnpm >=11.0.0`
- `.npmrc` 强制：
  ```
  strict-peer-dependencies=true   # peer dep 不满足直接报错
  engine-strict=true              # node/pnpm 版本不符拒绝安装
  save-exact=true                 # pnpm add 时不加 ^，锁精确版本
  ```
- `preinstall` 钩子：`npx only-allow pnpm` —— 拒绝 npm/yarn

### 1.2 workspace 声明

`pnpm-workspace.yaml`：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

hoisting: true   # 提升 node_modules（默认 true，显式声明）

overrides:        # 强制锁定 transitive dep 版本
  glob: 11.1.0
  lru-cache: 11.3.6

allowBuilds:      # pnpm 11 的构建审批白名单（17 个原生/构建包）
  - '@swc/core'
  - sharp
  - esbuild
  - core-js
  - '@parcel/watcher'
  - '@sentry/cli'
  - simple-git-hooks
  - unrs-resolver
  - vue-demi
  - ...（共 17 条）

catalog:          # 47 条统一版本锁定（见 1.3）
  vue: 3.5.34
  vite: 8.0.11
  typescript: 6.0.3
  ...
```

### 1.3 catalog：版本单一真相源

`catalog:` 是 pnpm 9.5+ 引入的特性。**所有共享依赖的版本集中在这一个块里声明**，各 workspace 包通过 `"xxx": "catalog:"` 引用（而不是写死版本号）。

实测 catalog 块共 **47 条**，覆盖核心依赖：`vue`、`vite`、`typescript`、`eslint`、`@antfu/eslint-config`、`naive-ui`、`pinia`、`vue-router`、`@vueuse/core`、`vue-i18n`、`axios`、`mongoose`、`@nestjs/{common,core,platform-express}`、`dayjs`、`lodash-es`、`@vitejs/plugin-vue`、`@swc/core`、`rimraf`、`taze` 等。

**引用方式**（各 workspace package.json）：

```json
{
  "devDependencies": {
    "eslint": "catalog:",        // 指向 catalog 中的 eslint 版本
    "typescript": "catalog:"
  }
}
```

**好处**：
- 升级 TypeScript？改一处 catalog，全仓库同步
- 不会出现 admin 用 TS 6.0、server 用 TS 5.9 的版本漂移
- `taze major -l`（`check:deps:update` 脚本）能统一检查更新

**历史**：catalog 是 commit `a3d466c "Phase A — pnpm catalog"` 引入的。在此之前，`migration-guide/09-known-issues.md` Issue #1/#2 记录的 ESLint/antfu 版本漂移（server 10.1.0、docs 9.30.1、root 10.3.0）就是 catalog 解决的问题。**这些 issue 实际已解决但文档未更新**。

### 1.4 overrides 与 allowBuilds

- **`overrides`**：强制 transitive dep 版本。当前锁定 `glob: 11.1.0` 和 `lru-cache: 11.3.6`——通常是为了解决某个间接依赖的 bug 或安全漏洞。
- **`allowBuilds`**：pnpm 11 引入的"构建审批"。pnpm 11 默认不运行依赖包的 install 脚本（postinstall 等），需要在白名单里显式批准。这里列了 17 个需要构建的原生包（`@swc/core`、`sharp`、`esbuild` 等）。这是 `migration-guide/09-known-issues.md` Issue #3 的解决方案。

### 1.5 单一 lockfile

仓库只有**一个** `pnpm-lock.yaml`（~1 MB）在根目录。没有 `package-lock.json`、`yarn.lock`。所有 workspace 包共享这一个 lockfile——这是 pnpm workspace 的标准行为，保证了全仓库依赖版本的完全一致性。

---

## 2. 任务编排：Turborepo

### 2.1 turbo.json 全文（实测）

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json", "tsconfig.json", "eslint.config.mjs"],
  "globalEnv": ["NODE_ENV"],
  "globalPassThroughEnv": ["CI", "GITHUB_TOKEN", "VERCEL_TOKEN", "TURBO_TOKEN", "TURBO_TEAM"],
  "tasks": {
    "build":       { "dependsOn": ["^build"], "outputs": ["dist/**", ".vitepress/dist/**"],
                     "inputs": ["src/**", "vite.config.*", "tsconfig.json", "package.json", "infra/**"], "cache": true },
    "dev":         { "persistent": true, "interruptible": true, "cache": false },
    "lint":        { "dependsOn": [], "inputs": ["src/**", "eslint.config.*", "tsconfig.json", "package.json"], "cache": true },
    "lint:fix":    { "dependsOn": [], "inputs": ["src/**", "eslint.config.*", "tsconfig.json", "package.json"], "cache": true },
    "types:check": { "dependsOn": ["^build"], "inputs": ["src/**", "tsconfig.json", "package.json"], "cache": true },
    "clean":       { "dependsOn": [], "cache": false },
    "clean:all":   { "dependsOn": [], "cache": false }
  }
}
```

### 2.2 任务详解（7 个 task）

| Task | dependsOn | cache | inputs | outputs | 说明 |
|------|-----------|-------|--------|---------|------|
| `build` | `^build` | ✅ | `src/**`、`vite.config.*`、`tsconfig.json`、`package.json`、`infra/**` | `dist/**`、`.vitepress/dist/**` | 先构建上游 workspace 依赖（`^` = 拓扑），再构建自己 |
| `dev` | — | ❌ | — | — | `persistent: true`（长运行）、`interruptible: true`（可被打断重启）。不缓存 |
| `lint` | — | ✅ | `src/**`、`eslint.config.*`、`tsconfig.json`、`package.json` | — | 各 app/package 自己的 eslint |
| `lint:fix` | — | ✅ | 同 lint | — | 自动修复 |
| `types:check` | `^build` | ✅ | `src/**`、`tsconfig.json`、`package.json` | — | 类型检查，先构建上游（因为要消费 `.d.ts`） |
| `clean` | — | ❌ | — | — | 清理当前包 |
| `clean:all` | — | ❌ | — | — | 清理所有（根脚本扩展到 node_modules） |

### 2.3 `^build` 拓扑排序的意义

`"dependsOn": ["^build"]` 的 `^` 前缀表示"先运行上游 workspace 依赖的 build"。例如：

```
turbo build --filter=@walnut/admin
```

会先 build `@walnut/shared`、`@walnut/axios`、`@walnut/core`（admin 依赖它们），再 build admin。

**当前的实际效果**：因为 shared/axios/core 的 `build` script 是 `echo 'no build needed'`（内部包模式不构建），这个 `^build` 实际上是空操作——但保留它是正确的，万一未来某个 package 加了真实 build 步骤，拓扑就会生效。

### 2.4 ⚠️ 缺失的 `test` task

**`turbo.json` 里没有 `test` task**，但 `apps/server/package.json` 有完整的 vitest 配置：

```json
"test": "vitest run",
"test:watch": "vitest",
"test:cov": "vitest run --coverage",
"test:e2e": "vitest run --config ./vitest.config.e2e.ts"
```

后果：
- `turbo test` 命令不存在（会报 "no task named test"）
- 跑 `turbo lint types:check build` 时**不会自动跑测试**
- CI 也无法用 `turbo test` 一键跑全仓库测试

**修复**：在 `turbo.json` 加：

```json
"test": { "dependsOn": [], "inputs": ["src/**", "test/**", "vitest.config.*", "tsconfig.json", "package.json"], "outputs": ["coverage/**"], "cache": true }
```

详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 5。

### 2.5 `globalDependencies` 的作用

```json
"globalDependencies": ["tsconfig.base.json", "tsconfig.json", "eslint.config.mjs"]
```

这三个文件**任何一个改动**，所有 task 的缓存都失效。这是合理的——tsconfig 改了，所有包都要重新 type-check/build。

**注意缺失**：`pnpm-workspace.yaml`（含 catalog）不在 `globalDependencies` 里。改 catalog 版本不会自动失效缓存——这可能导致依赖版本变了但 turbo 用旧缓存。建议补上。

### 2.6 根 package.json 的脚本编排

根 `package.json` 用 `turbo ... --filter` 路由到具体 app：

```json
"dev": "turbo dev",                                    // ⚠️ 同时启动三个 app
"dev:admin": "turbo dev --filter=@walnut/admin",
"dev:server": "turbo dev --filter=@walnut/server",
"dev:docs": "turbo dev --filter=@walnut/docs",
"build": "NODE_OPTIONS=--max-old-space-size=8192 turbo build",   // 8GB 堆内存
"build:stage": "turbo build --filter=@walnut/admin -- --mode staging",
"lint": "turbo lint",
"lint:fix": "turbo lint:fix",
"lint:root": "eslint . --concurrency=auto",            // 根级 eslint（turbo 外）
"types:check": "turbo types:check",
"clean": "turbo clean",
"clean:all": "rimraf node_modules apps/*/node_modules packages/*/node_modules build/node_modules"
```

**⚠️ 已知问题**：`pnpm dev`（无 filter）会**同时启动三个 app**——admin（需 MongoDB+Redis 才能用）、server（需 MongoDB+Redis）、docs。这在开发时几乎没人想要。`migration-guide/09-known-issues.md` Issue #9 记录。建议默认改为 `dev:admin` 或加确认提示。

---

## 3. Git Hooks：simple-git-hooks + lint-staged

### 3.1 配置（根 package.json 内联）

```json
"simple-git-hooks": {
  "pre-commit": "pnpm lint-staged",
  "pre-push": "pnpm types:check"
},
"lint-staged": {
  "*.{ts,vue,mjs,js}": "eslint --fix --concurrency=auto",
  "*.md": "eslint --fix"
}
```

- **pre-commit**：lint-staged 只检查暂存文件，自动 eslint fix
- **pre-push**：跑完整 `pnpm types:check`（`turbo types:check`，全仓库类型检查）——推送前确保类型安全
- `postinstall: npx simple-git-hooks` —— 每次 `pnpm install` 后重新安装 hooks

**为什么用 simple-git-hooks 而非 husky**：更轻量、零依赖配置文件、直接写在 package.json 里。husky 需要独立的 `.husky/` 目录和更多样板。

### 3.2 ⚠️ 没有 commitlint

`docs/monorepo.md`（历史文档）第 9 行声称有 `commitlint.config.mjs` 和 `@commitlint/cli 20.5.3`——**这个文件不存在**，`@commitlint/cli` 也没装。仓库当前**不校验 commit message 格式**。

虽然根 `package.json` 的 scripts 和 `CLAUDE.md` 文档化了 conventional commits 规范（feat/fix/docs/chore/...），但没有任何工具强制。这是可选改进项。

---

## 4. ESLint：antfu flat config

### 4.1 根配置（`eslint.config.mjs`）

```js
import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: ['**/dist/**', 'pnpm-lock.yaml'],
  markdown: false,
  unocss: true,
  rules: {
    'ts/no-namespace': 'off',
    'no-console': 'off',
    'regexp/no-unused-capturing-group': 'off',
    'pnpm/json-enforce-catalog': 'off',
    'pnpm/enforce-catalog': 'off',
    'pnpm/yaml-enforce-settings': 'off',
  },
})
```

### 4.2 关键点

- **`@antfu/eslint-config` 8.2.0**：Anthony Fu 的开箱即用 flat config，内置 Vue/TS/UnoCSS/import 排序/格式化（替代 Prettier）。仓库**没有单独的 `.prettierrc`**——antfu 包揽了格式化。
- **flat config**（非 legacy `.eslintrc`）：ESLint 9+ 的新配置格式，单一 `eslint.config.mjs` 文件。
- **关闭的规则**：
  - `ts/no-namespace: off` —— 允许 TS namespace（后端 `apps/server/libs/types/` 有用）
  - `no-console: off` —— 允许 console（由 build 时的 `drop_console` 控制）
  - `pnpm/*: off` —— **关闭了 catalog 强制规则**。这意味着如果某个 package.json 写了 `"eslint": "10.3.0"` 而不是 `"catalog:"`，ESLint 不会报错。注释说是因为 `trustPolicy` 被 6 个 transitive high-risk dep 阻塞——但这意味着 catalog 的使用**完全靠自觉**，新增依赖时容易漏写 `catalog:`。
- **`lint:root` 脚本**：根目录的 eslint 不走 turbo（因为根级文件不在任何 workspace 包里），用 `eslint . --concurrency=auto` 单独跑。

### 4.3 各 app 的 ESLint

| 位置 | 配置 | 特点 |
|------|------|------|
| 根 `eslint.config.mjs` | antfu 8.2.0 | 全局共享 |
| `apps/admin/` | 无独立配置 | 继承根（turbo lint 时用根配置） |
| `apps/docs/` | `apps/docs/eslint.config.mjs` | 独立（VitePress 专用规则） |
| `apps/server/` | `apps/server/eslint.config.mjs` + `eslint-local-rules.mjs` | **独立 + 自定义本地规则**（NestJS 装饰器排序规则） |

后端的 `eslint-local-rules.mjs` 是自带的「装饰器顺序」规则，强制 HTTP method → HttpCode → Permission → Role → Guards → CRUD → ... 的装饰器顺序。这是后端业务约定，根 ESLint 不该管。

---

## 5. 其他工具链元素

### 5.1 TypeScript 类型生成

- `apps/admin/types/auto-import.d.ts` —— `unplugin-auto-import` 生成（gitignored）
- `apps/admin/types/components.d.ts` —— `unplugin-vue-components` 生成（gitignored）

这两个文件由 Vite 插件在 dev/build 时自动生成，不入库。

### 5.2 PWA 资产生成

- 根脚本 `generate-pwa-assets: pwa-assets-generator`
- 配置在 `apps/admin/pwa-assets.config.ts`

### 5.3 Changelog 生成

- 根脚本 `changelog: tsx apps/admin/scripts/release/changelog.ts`
- 生成 `changelog-latest.md`（被 `.github/workflows/release.yml` 消费）
- 注意：脚本在 `apps/admin/scripts/` 但根调用——历史遗留（admin 是原始仓库根）

### 5.4 部署

- 根脚本 `deploy:stage` / `deploy:prod` 用 `deploy-cli-service`
- 配置 `apps/admin/deploy.config.cjs`（**含明文 SSH 密码**，虽然根 .gitignore 忽略 `deploy.config.*`，但此文件被 tracked——安全隐患，见 [07-known-issues.md](./07-known-issues.md)）

### 5.5 VSCode 工作区

`.vscode/`：
- `extensions.json` —— 推荐插件（Volar、UnoCSS、i18n-ally、gitlens、errorlens），标记 `octref.vetur` 为不想要
- `settings.json`（24 KB）—— 大量项目设置
- `settings-dev.schema.json`（15 KB）—— 开发设置 JSON Schema
- `vue.code-snippets` —— 单个 `v3setup` 代码片段

---

## 6. 工具链健康度小结

| 维度 | 状态 | 说明 |
|------|------|------|
| 包管理 | ✅ 良好 | catalog 统一版本，单一 lockfile |
| 任务编排 | ⚠️ 基本良好，缺 test task | turbo 配置合理，但漏了 test |
| Git hooks | ✅ 良好 | pre-commit lint + pre-push typecheck |
| Commit 规范 | ⚠️ 无强制 | 文档化了但无 commitlint |
| ESLint | ✅ 良好 | antfu 统一，后端有合理的本地规则 |
| CI/CD | ❌ 有问题 | 无 PR CI，deploy.yml 对 monorepo 坏掉（详见 [07-known-issues.md](./07-known-issues.md)） |

---

## 下一步

- TypeScript 配置策略 → [05-tsconfig-strategy.md](./05-tsconfig-strategy.md)
- 完整问题清单 → [07-known-issues.md](./07-known-issues.md)
- 修 CI/CD → [08-refactor-plan.md](./08-refactor-plan.md) Phase 5
