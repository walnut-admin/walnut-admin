# AGENTS.md - Walnut Admin Monorepo

> AI coding agents 工作指引（分发文档）。仓库权威概览见 [`CLAUDE.md`](./CLAUDE.md)，
> 架构决策与设计文档见 `apps/docs/src/zh-CN/content/monorepo/`（Turbo / TypeScript / pnpm Catalog / ESLint / Release / Knip / Syncpack / env 管理）与 `apps/docs/src/zh-CN/content/adr/`（ADR 0001-0019）。

## 仓库结构

```
apps/admin   @walnut/admin    Vue3 + Vite 8 + Naive UI + UnoCSS（前端 SPA）
apps/server  @walnut/server   NestJS 11 + SWC + Mongoose + Redis（后端，内部 Nest monorepo）
apps/docs    @walnut/docs     VitePress 文档站
packages/platform-any/   contract · types · utils-core     ← 平台无关（CJS 双模构建 / 纯类型 / 纯工具 @walnut/utils）
packages/platform-web/   client · http · ui               ← 浏览器/Vue（源码直消费，不构建）
packages/tooling/        tsconfig · eslint-config · commitlint-config · scripts · release
                         ← 工具链 5 包：@walnut/tsconfig（纯 JSON 预设 base/ts/vue）·
                           @walnut/eslint-config · @walnut/commitlint-config ·
                           @walnut/scripts（lib/ci/env + 3 bin）· @walnut/release（发版编排，bin walnut-release）
```

- 前端包 scope `@walnut/*`（ESM、pnpm workspace、Vite 编译）；后端内部 lib scope `@walnut-server/*`（CJS、tsconfig paths、SWC，见 `apps/server/`）。
- 模块边界由 Turbo boundaries 强制执行（tags 声明在各包 workspace 级 `turbo.json`），`pnpm boundaries` / pre-push / CI 三道闸。
- 全仓共 14 个 workspace 包（3 app + 3 platform-any + 3 platform-web + 5 tooling），同属 `pnpm-workspace.yaml` 的单一 `versioning.fixed` 组。
- tsconfig 走 `@walnut/tsconfig/*.json` 预设（`vue.json` 给浏览器/Vue、`ts.json` 给 Node 原生执行的代码、`base.json` 给由 jiti / commitlint loader 加载的根配置）；**`apps/server/tsconfig.json` 不 extends 任何预设**（ADR 0012）。根 `tsconfig.base.json` 已删除。
- **不许新建 `.mjs` / `.cjs`**：配置、ESLint 预设、bin、构建脚本一律 `.ts`；所有 `.ts` 入口都由 Node 24 原生类型剥离执行（**仓库内已无任何 `tsx` 依赖** —— 连 `apps/admin` 的 `predev` / `types:check:log` 也改走 `node`），该约束由 `ts.json` 的 `erasableSyntaxOnly` 在编译期保证（ADR 0019）。

## 常用命令

```bash
pnpm install          # 安装（pnpm 专用，由 packageManager 字段 + corepack 强制）
pnpm dev              # 前端（= turbo dev --filter=@walnut/admin，http://127.0.0.1:3100；`dev:admin` 已删除）
pnpm dev:server       # 后端（需 MongoDB replica set + Redis，从 apps/server 运行）
pnpm dev:docs         # 文档站（http://localhost:8886）
pnpm build            # 全量构建（packages → apps）
pnpm build:stage      # admin stage 构建（turbo build:stage 任务）
pnpm lint / lint:fix  # ESLint（stylistic 承担格式化，无 Prettier）
pnpm lint:root        # 只 lint 根级配置（eslint *.ts *.json *.yaml；根级文件不在 `turbo lint` 范围内）
pnpm types:check      # 全仓类型检查（admin/docs/ui 用 vue-tsc，其余 tsc，server strict）
pnpm types:check:root # 只检查根级配置（tsc -p tsconfig.json）
pnpm test             # vitest（server / contract / utils / client / scripts / release）
pnpm boundaries       # Turbo 架构边界检查
pnpm lint:workflows   # actionlint 校验 .github/workflows（CI 强制）
pnpm prepush          # pre-push 的聚合门禁：boundaries + lint:root + types:check + types:check:root + syncpack + lint:workflows + pnpm change check
pnpm hooks:check      # 断言 git 钩子由 lefthook 托管（防门禁静默消失）
pnpm release          # 发版（pnpm 原生 release management + git-cliff，详见 docs 的 release.md）
pnpm setup-env        # 解密 env-encrypted/ → env-local/（需根 .env.keys）
pnpm knip             # 死代码检测
```

## 环境配置

- `env-encrypted/` 密文随仓库提交（dotenvx，文件内注释即模板）；`pnpm setup-env` 解密到 gitignore 的 `env-local/`；私钥 `.env.keys` 经 1Password 共享。
- CI 通过 GitHub Secret `ENV_KEYS`（内容即 `.env.keys` 全文）自动解密并启用 admin 构建（旧文档里的 `DOTENVX_KEYS_FILE` 已废弃）。⚠️ 它只能绑到 job 级 `env` 后用 `env.X != ''` 判断 —— `secrets` 上下文不允许出现在 step/job 的 `if` 里，否则整个 workflow 会被判为 `Invalid workflow file`（启动即失败、0 个 job）。
- 后端必须从 `apps/server/` 目录运行（ConfigModule 用 `process.cwd()` 定位 env）。

## 关键纪律

1. **依赖**：只用 pnpm；新依赖一律走 `catalog:`（`pnpm-workspace.yaml`，strict 模式强制）；workspace 内部引用用 `workspace:*`（syncpack 强制）。
2. **提交**：conventional commits，scope 必填，且必须是 workspace 包名（如 `feat(admin): …`、`fix(contract): …`）或基础设施 scope（`docker` / `deploy` / `pnpm` / `release` —— `release` 只给发版记账提交 `chore(release): vX.Y.Z` 用，工具链包的改动走 `tooling`）。发版归属**路径优先、scope 兜底**，基础设施 scope 与未在册 scope 不产生意图（见 release.md）。pre-push 是一条聚合命令 `pnpm prepush`：boundaries + lint:root + types:check + types:check:root + syncpack + lint:workflows + `pnpm change check`（七段，fixed 组锁步）；钩子由 lefthook 托管（根 `lefthook.yml`，见 ADR 0018），装没装上用 `pnpm hooks:check` 机械核对。
3. **导入**：admin 用 `@/*` → `apps/admin/src/*`、`~/*` → `apps/admin/types/*`；server 用 `@/*` → `apps/api/src/*`、`@walnut-server/*` → `libs/*/src`。跨模块禁止相对路径。
4. **Auto-import 克制**：`unplugin-auto-import` 存在，但大项目显式导入优先——迁入 packages 的代码必须显式 import。
5. **共享契约**：跨端常量只改 `@walnut/contract`（前后端直接消费，无包装层，ADR 0004）；contract 有快照测试守护，改动会触发快照 diff。
6. **测试**：新增纯函数/工具必须补测试（现有模式见 `packages/platform-any/utils-core/src/**/*.test.ts`）。
7. **注释**：`// LINK` 引用资料、`// TODO`/`// FIXME` 待办；中英混用可接受，文档以中文为主。
8. **组件**：`ComponentName/index.ts`（导出）+ `ComponentName/index.vue`（实现）；API 函数以 `API` 结尾。
9. **存储迁移**：改动持久化结构时同步 `src/utils/persistent/migrate.ts`（admin 侧）。

## 各 app 专属指引

- `apps/server/CLAUDE.md` — 后端模块架构、Repository 三模式、DTO 装饰器规则、Guard 顺序
- `apps/docs/CLAUDE.md` — 文档站结构、VitePress 配置
- `apps/server/AGENTS.md` — 后端详细文档索引（.agents/docs/ 14 篇）

## 资源

- 演示：https://www.walnut-admin.com ｜ 文档：https://walnut-admin-doc.netlify.app
- Vue 3 · Naive UI · UnoCSS · Vite · NestJS · Mongoose · Redis
