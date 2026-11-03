<!-- PROJECT LOGO -->
<p align="center">
  <a href="">
    <img src="https://github.com/walnut-admin/walnut-admin-client/blob/main/public/logo.png" alt="Logo" width="80" height="80">
  </a>

  <h1 align="center">Walnut Admin</h1>
  <p align="center">
    A full-stack back-office management system — Vue3 + NestJS + PostgreSQL
    <br />
    <a target="_blank" href="https://walnut-admin-doc.netlify.app/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a target="_blank" href="https://www.walnut-admin.com">View Demo</a>
    ·
    <a target="_blank" href="https://github.com/walnut-admin/walnut-admin/issues">Report a Bug</a>
  </p>
</p>

## Monorepo Structure

15 个 workspace 包，按**目录组**分成 apps / platform-any / platform-web / generated / tooling 五组（**包数以 `pnpm-workspace.yaml` 的 `packages` 字段为判据**，分组以目录结构为判据 —— 这里刻意不写每组的个数），同属 `pnpm-workspace.yaml` 的单一 `versioning.fixed` 组：

```
walnut-admin/
├── apps/
│   ├── admin/     @walnut/admin    — Vue3 SPA + Vite 8 + Naive UI + UnoCSS
│   ├── server/    @walnut/server   — NestJS 12 + SWC + TypeORM + PostgreSQL + Redis（内部 Nest monorepo）
│   └── docs/      @walnut/docs     — VitePress 文档站
├── packages/
│   ├── platform-any/                — 平台无关（CJS 双模构建 / 纯类型 / 纯工具）
│   │   ├── contract/    @walnut/contract   — 类型与常量（响应码、枚举、分页、路由契约）
│   │   ├── types/       @walnut/types      — 纯类型声明（只有前端消费）
│   │   └── utils-core/  @walnut/utils      — 两端同源的纯函数（签名原文、对象扁平化）
│   ├── platform-web/                — 浏览器 / Vue（源码直消费，不构建）
│   │   ├── client/      @walnut/client     — 浏览器工具 + Vue composables + store 工厂
│   │   └── http/        @walnut/http       — HTTP 客户端框架（实例 + 适配器）
│   ├── generated/                   — 零手写的生成物包
│   │   └── api-types/   @walnut/api-types  — 由 openapi.json 生成的 API 类型
│   └── tooling/                     — 工具链 6 包
│       ├── tsconfig/          @walnut/tsconfig          — 纯 JSON tsconfig 预设（base / ts / vue）
│       ├── eslint-config/     @walnut/eslint-config     — 共享 ESLint 预设（base / vue / nest）
│       ├── commitlint-config/ @walnut/commitlint-config — commitlint 规则
│       ├── vitest-config/     @walnut/vitest-config     — 共享 Vitest 预设（发现规则 / 环境 / 覆盖率）
│       ├── scripts/           @walnut/scripts           — 仓库级脚本：lib / ci 门禁 / env 加解密 + bin（清单见其 package.json 的 `bin` 字段）
│       └── release/           @walnut/release           — 发版编排（bin walnut-release）
├── turbo.json                    — Turborepo pipeline
└── pnpm-workspace.yaml           — pnpm workspace + 版本策略（versioning.fixed 唯一真源）
```

> 架构决策见 [`apps/docs/src/zh-CN/content/`](./apps/docs/src/zh-CN/content/)：
> [monorepo 架构](./apps/docs/src/zh-CN/content/monorepo/) · [ADR](./apps/docs/src/zh-CN/content/adr/) ·
> [归档设计/评审](./apps/docs/src/zh-CN/content/archive/)。
> 给 AI agent 的工作指引见 [`AGENTS.md`](./AGENTS.md)。

## Quick Start

**Requirements:** Node.js >= 24.15.0, pnpm >= 12.0.0

```bash
pnpm install

# Start dev servers
pnpm dev           # 前端 + 后端（前端 → http://127.0.0.1:3100；后端需 PostgreSQL + Redis）
pnpm dev:server    # 只起后端
pnpm dev:docs      # 只起文档站 → http://localhost:8886

# 只起前端（不需要 Mongo + Redis，也没有后端那一路的日志）
pnpm exec turbo dev --filter=@walnut/admin

# Build
pnpm build         # 全量（packages → apps）
pnpm build:admin
pnpm build:server
pnpm build:docs

# Lint & type check & test
pnpm lint          # 各包的 lint 任务
pnpm lint:root     # 只 lint 根级配置
pnpm types:check   # 全仓类型检查
pnpm test          # vitest（哪些包有 test 任务以各包 package.json 为准）
pnpm prepush       # 推送前门禁表（packages/tooling/scripts/src/ci/prepush.ts，并行）
```

## History

This monorepo was created by merging three previously separate repositories:
- [walnut-admin-client](https://github.com/walnut-admin/walnut-admin-client) — Vue3 frontend (now `apps/admin/`)
- [walnut-admin-server](https://github.com/walnut-admin/walnut-admin-server) — NestJS backend (now `apps/server/`)
- [walnut-admin-doc](https://github.com/walnut-admin/walnut-admin-doc) — Vitepress docs (now `apps/docs/`)

See [`apps/docs/src/zh-CN/content/`](./apps/docs/src/zh-CN/content/) for the architecture documentation and refactor roadmap ([monorepo architecture](./apps/docs/src/zh-CN/content/monorepo/) / [ADRs](./apps/docs/src/zh-CN/content/adr/) / [archived design & review docs](./apps/docs/src/zh-CN/content/archive/)), and [`AGENTS.md`](./AGENTS.md) for the agent-facing guide.
