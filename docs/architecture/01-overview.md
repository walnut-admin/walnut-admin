# 01 · 现状全景

> 数据采集时间：2026-07-26 · 基于仓库 commit `fc455fc`（HEAD of `main`）

---

## 1. 项目定位

**Walnut Admin** 是一个开源的全栈后台管理系统模板，由三个原本独立的仓库在 2026 年中物理合并为单一 monorepo：

| 原仓库 | 合并后位置 | 角色 |
|--------|------------|------|
| `walnut-admin-client` | `apps/admin/` | Vue 3 SPA 前端 |
| `walnut-admin-server` | `apps/server/` | NestJS + MongoDB 后端 |
| `walnut-admin-doc` | `apps/docs/` | VitePress 文档站 |

合并采用 **pnpm workspaces + Turborepo** 作为 monorepo 基础设施，根 `package.json` 的 `name` 为 `walnut-admin`，`private: true`。

---

## 2. 顶层目录结构（实测）

```
D:\walnut\walnut-admin\
├── apps/
│   ├── admin/      @walnut/admin   — Vue 3 SPA 前端 (v1.18.0)
│   ├── server/     @walnut/server  — NestJS API 后端 (v1.18.0)
│   └── docs/       @walnut/docs    — VitePress 文档站 (v1.0.0)
├── packages/
│   ├── shared/     @walnut/shared  — 零依赖基础库 (v0.0.1) 【真实】
│   ├── axios/      @walnut/axios   — HTTP 客户端框架 (v0.0.1) 【真实】
│   ├── core/       @walnut/core    — 通用 composables (v0.0.1) 【部分真实】
│   ├── ui/         @walnut/ui      — W* 组件库 (v0.0.1) 【空壳 stub】
│   └── ai/         @walnut/ai      — AI 聊天子系统 (v0.0.1) 【空壳 stub】
├── docs/
│   ├── monorepo.md                — ⚠️ 历史文档（已过时，见 README 说明）
│   └── architecture/              — 本目录
├── migration-guide/               — ⚠️ 历史档案（11 个迁移记录文件）
├── .github/workflows/             — deploy.yml + release.yml
├── .claude/skills/                — 5 个 server 端 AI 技能
├── .vscode/                       — 工作区设置 + 代码片段
├── package.json                   — 根 workspace（含 turbo 脚本编排）
├── pnpm-workspace.yaml            — workspace 声明 + catalog + overrides + allowBuilds
├── pnpm-lock.yaml                 — 单一 lockfile (~1 MB)
├── turbo.json                     — Turborepo 任务图（7 个 task）
├── tsconfig.json                  — 根工具 tsconfig
├── tsconfig.base.json             — 前端共享 tsconfig base
├── tsconfig.base.node.json        — ⚠️ 后端 tsconfig base（孤儿，零消费者）
├── eslint.config.mjs              — 根 ESLint（antfu flat config）
├── .npmrc                         — engine-strict + save-exact + strict-peer
├── AGENTS.md / CLAUDE.md / README.md / TODO.md
└── changelog-latest.md            — 发布说明（被 release.yml 消费）
```

> 各 app/package 的真实状态（含字节数证据）详见 [02-workspace-layout.md](./02-workspace-layout.md)。

---

## 3. 技术栈版本矩阵（基于 pnpm-workspace.yaml `catalog:` 实测）

`pnpm-workspace.yaml` 的 `catalog:` 块是全仓库依赖版本的**单一真相源**（single source of truth）。关键版本：

| 依赖 | 锁定版本 | catalog 引用方 |
|------|----------|----------------|
| `typescript` | `6.0.3` | root + 所有 app/package |
| `eslint` | `10.3.0` | root + 所有 app/package |
| `vue` | `3.5.34` | admin、ui、ai（peerDep） |
| `vite` | `8.0.11` | admin、docs |
| `@vitejs/plugin-vue` | `6.0.6` | admin、docs |
| `pinia` | `3.0.4` | admin、core（peerDep） |
| `vue-router` | `5.0.6` | admin、core（peerDep） |
| `naive-ui` | `2.44.1` | admin、ui（peerDep） |
| `@vueuse/core` | `14.3.0` | admin、core（peerDep） |
| `axios` | `1.16.0` | admin、axios 包（peerDep）、server |
| `mongoose` | `9.3.3` | server |
| `@nestjs/common` / `core` / `platform-express` | `11.1.17` | server |
| `dayjs` | `1.11.20` | admin、server |
| `lodash-es` | `4.18.1` | admin |
| `@swc/core` | （在 allowBuilds 中） | server |

**环境要求**（`package.json` + `.npmrc` 强制）：
- `node >= 24.13.0`（`.npmrc` 的 `engine-strict=true` 会拒绝低版本）
- `pnpm >= 11.0.0`
- `packageManager: pnpm@11.13.0`（Corepack 锁定）

> ⚠️ `AGENTS.md`（根）记录的版本是 `Vue 3.5.21 / TS 5.9.2 / Vite 7.1.5` 等——这是**合并前** `walnut-admin-client` 单包的旧版本，已过时。详见 [07-known-issues.md](./07-known-issues.md) 问题 #11。

---

## 4. 工作区依赖图（实测）

### 4.1 apps 对 packages 的依赖

```
apps/admin   ──→ @walnut/shared, @walnut/axios, @walnut/core, @walnut/ui, @walnut/ai
apps/server  ──→ （零 workspace 依赖，自包含）
apps/docs    ──→ （零 workspace 依赖，纯 VitePress）
```

**关键事实**：
- **后端不消费任何 `packages/*`**。`apps/server/package.json` 没有 `"workspace:*"` 引用。
- **前后端零契约共享**。前端 `apps/admin/src` 不 import 后端的 `@walnut/{config,db,...}` 别名（已 grep 验证，零命中），后端也不 import 前端的 `@walnut/{shared,...}` 包。前后端各自维护自己的类型/常量定义，已发生 6 处可证实的重复（详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 4）。

### 4.2 packages 之间的依赖

```
packages/ai      ──→ @walnut/ui + @walnut/core + @walnut/axios + @walnut/shared
packages/ui      ──→ @walnut/core + @walnut/shared
packages/core    ──→ @walnut/shared
packages/axios   ──→ @walnut/shared
packages/shared  ──→ （零依赖，最底层）
```

依赖方向严格单向向下，`@walnut/shared` 是唯一的零依赖基础包。

> ⚠️ `packages/ui` 和 `packages/ai` 虽然在 `package.json` 里声明了上述依赖，但它们自身是**空壳 stub**（详见 02），所以这些依赖声明目前是"摆设"。

### 4.3 后端的「内部 monorepo」

`apps/server/` 内部藏着一整套 **NestJS-CLI monorepo**，这是合并前的原始结构被原样保留：

```
apps/server/
├── apps/api/                  ← 主应用（NestJS entry）
├── libs/
│   ├── config/    @walnut/config       ← 这些 @walnut/* 是 tsconfig path 别名
│   ├── const/     @walnut/const           不是 pnpm workspace 包！
│   ├── context/   @walnut/context
│   ├── db/        @walnut/db
│   ├── decorators/ @walnut/decorators
│   ├── exceptions/ @walnut/exceptions
│   ├── pipes/     @walnut/pipes
│   ├── types/     @walnut/types
│   └── utils/     @walnut/utils
├── infra/nest/{dev,prod,stage}.json   ← NestJS-CLI monorepo 配置
├── infra/swc/{dev,prod,stage}.swcrc   ← SWC 编译配置（含 path 解析）
└── tsconfig.json                       ← 自包含，不 extends 根 base
```

**这是核心架构隐患之一**：前端的 5 个 `@walnut/*` 是 pnpm workspace 真包，后端的 9 个 `@walnut/*` 是 tsconfig path 别名。两者共用同一个 `@walnut` scope，目前靠"名字不重叠"侥幸不冲突。任何人在前端加一个 `@walnut/utils` 就会静默炸掉。详见 [03-package-boundaries.md](./03-package-boundaries.md)。

---

## 5. Git 历史与合并来源

仓库 git 历史很短（约 10 个 commit），证实是全新的结构合并：

```
fc455fc chore: migrate .github CI/CD and .claude skills from original repos, adapt for monorepo
eefc5ea docs: add monorepo architecture documentation (Chinese)   ← 生成了 docs/monorepo.md
b6cd90c fix: root tsconfig no longer extends ESM base — removes CJS/ESM architecture confusion
99548f7 chore: Phase B — TypeScript config restructuring + root lint coverage
a3d466c chore: Phase A — pnpm catalog + unified dependency management
（更早的 commit 是三仓库物理拷贝合并）
```

**合并方式**：文件 `cp -r` 拷贝（非 `git filter-repo`），因此**原三仓库的 git 历史已丢失**。这是 `migration-guide/09-known-issues.md` 记录的 Issue #10，已知且无法挽回。

---

## 6. 当前能力与缺口一览

### ✅ 已经做对的
- pnpm workspace + catalog 统一版本管理（47 条 catalog 条目）
- 单一 `pnpm-lock.yaml`
- Turborepo 任务图（`^build` 拓扑排序、缓存、inputs/outputs）
- 根 ESLint（antfu flat config）+ simple-git-hooks（pre-commit lint-staged / pre-push types:check）
- `tsconfig.base.json` 作为前端共享 base（admin + docs + 5 packages 都 extends 它）
- 前端内部包模式工作正常（shared/axios/core 源码被 admin 实际消费）

### ⚠️ 存在底层隐患的（详见 [07-known-issues.md](./07-known-issues.md)）
- `@walnut` 命名空间双重定义（前端 workspace 包 + 后端 path 别名）
- `packages/ui`、`packages/ai` 是空壳 stub，admin 的 package.json 还声明依赖它们
- `tsconfig.base.node.json` 是孤儿文件（定义了没人 extends）
- `tsconfig.base.json` 的 `paths` 因子配置覆盖 `baseUrl` 而失效（实际靠 pnpm symlink + exports 工作）
- 4 处跨包 `.d.ts` 相对路径 reach（admin/axios/core 直接 include `../../packages/shared/src/types/*.d.ts`）
- 前后端无共享契约层，6 处类型/常量重复手工维护
- `.github/workflows/deploy.yml` 用 SCP + 远程 `pnpm install --prod`，对 monorepo 根 lockfile 完全坏掉（文件内有 `TODO: monorepo 适配` 标注）
- 无 PR/push 的 lint/build CI
- `turbo.json` 无 `test` task（虽然 server 有 vitest）
- 根 `AGENTS.md` 描述的是合并前的单包客户端，全部过时

---

## 下一步

- 想看每个 app/package 的精确职责和真实文件树 → [02-workspace-layout.md](./02-workspace-layout.md)
- 想深入命名空间问题 → [03-package-boundaries.md](./03-package-boundaries.md)
- 想看完整问题清单 → [07-known-issues.md](./07-known-issues.md)
- 想动手改 → [08-refactor-plan.md](./08-refactor-plan.md)
