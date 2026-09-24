# AGENTS.md - Walnut Admin Monorepo

> **本仓 agent 指引的唯一真源。** 用的是跨工具的开放格式
> （[agents.md](https://agents.md/)，60k+ 项目在用；Codex / Cursor / Copilot / Gemini CLI 等都读）。
>
> ⚠️ 根 [`CLAUDE.md`](./CLAUDE.md) **只有一行 `@AGENTS.md` 导入**，别往它里面写内容 ——
> Claude Code 在两者并存时**默认只读 `CLAUDE.md`**，那行导入是它拿到本文件的唯一路径。
>
> 包级指引见下方「包级指引」表：按 agents.md 约定，agent 读**离被改文件最近**的那份。
>
> 架构决策与设计文档在 [`apps/docs/src/zh-CN/content/`](./apps/docs/src/zh-CN/content/)
> （monorepo 架构 10 篇 / ADR 0001-0019 / 归档的设计·计划·评审）。

## 技术栈与版本

| 目录 | 包 | 技术栈 |
|------|----|--------|
| `apps/admin/` | `@walnut/admin` | Vue 3 + Vite 8 + Naive UI + UnoCSS（前端 SPA，默认端口 3100） |
| `apps/server/` | `@walnut/server` | NestJS 11 + SWC + Mongoose + Redis（**自有内部 Nest monorepo**） |
| `apps/docs/` | `@walnut/docs` | VitePress 文档站（端口 8886） |

Node >= 24.13.0 ｜ pnpm >= 12.0.0 ｜ TypeScript 6.0.3 ｜ Turbo 2.11.2

## 仓库结构

```
apps/admin   @walnut/admin    Vue3 + Vite 8 + Naive UI + UnoCSS（前端 SPA）
apps/server  @walnut/server   NestJS 11 + SWC + Mongoose + Redis（后端，内部 Nest monorepo）
apps/docs    @walnut/docs     VitePress 文档站
packages/platform-any/   contract · types · utils-core     ← 平台无关（CJS 双模构建 / 纯类型 / 纯工具 @walnut/utils）
packages/platform-web/   client · http · ui               ← 浏览器/Vue（源码直消费，不构建）
packages/tooling/        tsconfig · eslint-config · commitlint-config · vitest-config · scripts · release
                         ← 工具链 6 包：@walnut/tsconfig（纯 JSON 预设 base/ts/vue）·
                           @walnut/eslint-config · @walnut/commitlint-config ·
                           @walnut/vitest-config（共享测试预设）·
                           @walnut/scripts（lib/ci/env + 8 bin）· @walnut/release（发版编排，bin walnut-release）
```

- 前端包 scope `@walnut/*`（ESM、pnpm workspace、Vite 编译）；后端内部 lib scope `@walnut-server/*`
  （CJS、tsconfig paths、SWC，见 [`apps/server/AGENTS.md`](./apps/server/AGENTS.md)）。
- 全仓共 **15 个 workspace 包**（3 app + 3 platform-any + 3 platform-web + 6 tooling），同属
  `pnpm-workspace.yaml` 的单一 `versioning.fixed` 组 —— 组长必须恒等于「有 version 的包数」，
  由 `versioning-config.test.ts` 机械拦。
- `apps/server/` 内部另有 **9 个 NestJS 内部库**
  （`libs/{config,const,context,db,decorators,exceptions,pipes,types,utils}`）—— 它们**不是**
  workspace 包，规则见包级指引。
- `apps/admin/build/` 是前端的 Vite 构建配置（plugins / config / proxy），不是运行时源码。
- 模块边界由 Turbo boundaries 强制（tags 声明在各包 workspace 级 `turbo.json`），
  `pnpm boundaries` / pre-push / CI 三道闸。
- tsconfig 走 `@walnut/tsconfig/*.json` 预设（`vue.json` 浏览器/Vue、`ts.json` Node 原生执行的代码、
  `base.json` 由 jiti / commitlint loader 加载的根配置）；**`apps/server/tsconfig.json` 不 extends 任何预设**（ADR 0012）。

## 包级指引

按 agents.md「最近的赢」约定，有**非显然规则**的目录各有一份指引；其余包继承本文件：

| 目录 | 指引 | 里面写了什么规则 |
|------|------|------------------|
| `apps/server/` | [`apps/server/AGENTS.md`](./apps/server/AGENTS.md) | 内部 Nest monorepo 的形态、`@walnut-server/*` 命名空间策略、必须从本目录运行的命令 |
| `apps/admin/` | [`apps/admin/AGENTS.md`](./apps/admin/AGENTS.md) | `@/*` `~/*` 别名、auto-import 的克制原则、组件与 store 的约定 |
| `apps/docs/` | [`apps/docs/AGENTS.md`](./apps/docs/AGENTS.md) | VitePress 结构、**死链校验与 `${{ }}` 两个坑**、新增页面要改侧边栏 |

`packages/**` 目前没有包级指引 —— 有非显然规则时再加，**不要为凑数而写**。

## 常用命令

```bash
pnpm install          # 安装（pnpm 专用，由 packageManager 字段 + corepack 强制）
pnpm dev              # 前端 + 后端（前端 3100；后端需 MongoDB replica set + Redis）
pnpm dev:server       # 只起后端（从根经 turbo 跑，cwd 是 apps/server）
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
pnpm lint:docs-refs   # 校验活文档正文引用的包名 / 仓库路径是否真实存在
pnpm lint:adr         # 校验 ADR 形态（编号连续 / Status 在枚举内 / 四个必需小节 / index 双向对齐）
pnpm lint:doc-ts      # 校验文档里标注 ts 的代码块能按 TypeScript 解析（JSON 不许标成 ts）
pnpm lint:doc-budget  # 校验常驻上下文的几个文档没膨胀（预算用不到一半也算失败）
pnpm prepush          # 推送前门禁表（packages/tooling/scripts/src/ci/prepush.ts，并行跑、每段报耗时）
pnpm hooks:check      # 断言 git 钩子由 lefthook 托管（防门禁静默消失）
pnpm release          # 发版（pnpm 原生 release management + git-cliff，详见 docs 的 release.md）
pnpm setup-env        # 解密 env-encrypted/ → env-local/（需根 .env.keys）
pnpm knip             # 死代码检测（**当前是红的且有意维持**，理由见 knip.config.ts 顶部注释）
```

## 环境配置

- `apps/server/env-encrypted/` 密文随仓库提交（dotenvx，文件内注释即模板）；`pnpm setup-env` 解密到
  gitignored 的 `apps/server/env-local/`；私钥 `.env.keys` 经 1Password 共享。
- CI 通过 GitHub Secret `ENV_KEYS`（内容即 `.env.keys` 全文）自动解密并启用 admin 构建（旧文档里的
  `DOTENVX_KEYS_FILE` 已废弃）。⚠️ 它只能绑到 job 级 `env` 后用 `env.X != ''` 判断 —— `secrets`
  上下文不允许出现在 step/job 的 `if` 里，否则整个 workflow 会被判为 `Invalid workflow file`
  （启动即失败、0 个 job）。
- 后端必须从 `apps/server/` 目录运行（ConfigModule 用 `process.cwd()` 定位 env）。

## 关键纪律

1. **依赖**：只用 pnpm；新依赖一律走 `catalog:`（`pnpm-workspace.yaml`，strict 模式强制）；workspace 内部引用用 `workspace:*`（syncpack 强制）。
2. **提交**：conventional commits，scope 必填，且必须是 workspace 包名（如 `feat(admin): …`、`fix(contract): …`）或基础设施 scope（`docker` / `deploy` / `pnpm` / `release` —— `release` 只给发版记账提交 `chore(release): vX.Y.Z` 用，工具链包的改动走 `tooling`）。发版归属**路径优先、scope 兜底**，基础设施 scope 与未在册 scope 不产生意图（见 release.md）。pre-push 是一条聚合命令 `pnpm prepush`（= `walnut-prepush`）—— 它跑**一张门禁表**（并行、每段报耗时；表只有一处：`packages/tooling/scripts/src/ci/prepush.ts`，含 fixed 组锁步那段）；钩子由 lefthook 托管（根 `lefthook.yml`，见 ADR 0018），装没装上用 `pnpm hooks:check` 机械核对。
3. **导入**：admin 用 `@/*` → `apps/admin/src/*`、`~/*` → `apps/admin/types/*`；server 用 `@/*` → `apps/api/src/*`、`@walnut-server/*` → `libs/*/src`。跨模块禁止相对路径。
4. **Auto-import 克制**：`unplugin-auto-import` 存在，但大项目显式导入优先——迁入 packages 的代码必须显式 import。
5. **共享契约**：跨端常量只改 `@walnut/contract`（前后端直接消费，无包装层，ADR 0004）；contract 有快照测试守护，改动会触发快照 diff。
6. **测试**：新增纯函数/工具必须补测试（现有模式见 `packages/platform-any/utils-core/src/**/*.test.ts`）。
7. **注释**：`// LINK` 引用资料、`// TODO`/`// FIXME` 待办；中英混用可接受，文档以中文为主。
8. **组件**：`ComponentName/index.ts`（导出）+ `ComponentName/index.vue`（实现）；API 函数以 `API` 结尾。
9. **存储迁移**：改动持久化结构时同步 `src/utils/persistent/migrate.ts`（admin 侧）。
10. **不许新建 `.mjs` / `.cjs`**：配置、ESLint 预设、bin、构建脚本一律 `.ts`；所有 `.ts` 入口都由 Node 24 原生类型剥离执行（**仓库内已无任何 `tsx` 依赖** —— 连 `apps/admin` 的 `predev` / `types:check:log` 也改走 `node`），该约束由 `ts.json` 的 `erasableSyntaxOnly` 在编译期保证（ADR 0019）。
11. **改文档要过门禁**：`pnpm lint:docs-refs` 校验正文里引用的包名与仓库路径；`pnpm lint:adr` 校验 ADR 形态（形状约定见 [`adr/index.md`](./apps/docs/src/zh-CN/content/adr/index.md)）；`pnpm lint:doc-ts` 校验标成 `ts` 的代码块能按 TypeScript 解析（**JSON 别标成 `ts`**，有意伪代码写 `// @pseudo`）；`pnpm lint:doc-budget` 校验常驻文件没膨胀；`pnpm build:docs` 会因死链失败。**别在正文里写原始 `${{ }}`**（VitePress 当 Vue 插值，构建直接炸 —— 见 [`apps/docs/AGENTS.md`](./apps/docs/AGENTS.md)）。**也别写会腐烂的计数**（包数 / bin 数 / 依赖条目数）—— 那类数字没有门禁拦得住；优先写判据。细节见同一个文件的重要约定 8 / 9。

## 各 app 专属指引

- [`apps/server/AGENTS.md`](./apps/server/AGENTS.md) — 后端模块架构、Repository 三模式、DTO 装饰器规则、Guard 顺序（含全部后端规矩）
- [`apps/admin/AGENTS.md`](./apps/admin/AGENTS.md) — 前端别名、auto-import、组件与 store 约定
- [`apps/docs/AGENTS.md`](./apps/docs/AGENTS.md) — 文档站结构与两个构建坑

## 资源

- 演示：https://www.walnut-admin.com ｜ 文档：https://walnut-admin-doc.netlify.app
- Vue 3 · Naive UI · UnoCSS · Vite · NestJS · Mongoose · Redis
