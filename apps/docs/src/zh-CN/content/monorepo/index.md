# Monorepo 架构与设计体系

## 概述

Walnut Admin 是一个**全栈 TypeScript monorepo**，采用 **Turborepo + pnpm workspaces** 管理 8 个包（3 个 app + 5 个共享包）。项目从三个独立仓库合并而来，通过 pnpm catalog 统一依赖版本、Turborepo 编排任务、Changesets 管理版本号，构建了一套可维护的 monorepo 基础设施。

### 技术栈速览

| 层级 | 技术 |
|------|------|
| 包管理 | pnpm 11+（workspace + catalog，`catalogMode: strict`） |
| 任务编排 | Turborepo 2.9（任务拓扑 + 缓存 + 架构边界） |
| 类型系统 | TypeScript 6.0（前端 ESM + 后端 CJS，双轨 toolchain） |
| 代码检查 | ESLint 10.3 flat config + `@antfu/eslint-config` + `@walnut/eslint-config` |
| 格式化 | Prettier 3（根目录统一管理） |
| 版本管理 | Changesets（fixed group 共享包 + independent apps） |
| 变更日志 | git-cliff（conventional commits 分组渲染） |
| 死代码检测 | Knip 6.29 |
| Git Hooks | simple-git-hooks + lint-staged |
| 前端框架 | Vue 3 + Vite 8 + Naive UI + UnoCSS |
| 后端框架 | NestJS 11 + SWC + Mongoose + Redis |
| 文档引擎 | VitePress 1.6 |
| Node 要求 | >= 24.13.0 |

---

## 架构文档索引

以下是按主题拆分的架构文档，每个文档覆盖一个顶层设计领域：

| 文档 | 主题 |
|------|------|
| [TypeScript 配置](./typescript.md) | tsconfig 分层策略、root base vs server 独立、不用 Project References |
| [ESLint 配置](./eslint.md) | Flat config、`@walnut/eslint-config` 三预设、pre-commit/pre-push 门禁 |
| [package.json & Scripts](./package-scripts.md) | 标准 script 约定、根只做委托、按包类型差异化 |
| [pnpm Catalog](./pnpm-catalog.md) | `catalogMode: strict`、精确版本锁死、`workspace:*` vs `catalog:` |
| [Turbo](./turbo.md) | 任务拓扑编排、缓存策略、环境变量感知、Tag-Based 架构边界 |
| [Release & Changeset](./release-changeset.md) | Fixed group 5包同步、3app 独立、auto-changeset 自动生成 |
| [Git-cliff](./git-cliff.md) | Conventional commits 分组、changelog 渲染、发布流程中的位置 |
| [Knip 死代码检测](./knip.md) | 死代码检测、配置设计、已知局限、日常维护 |
| [环境变量加密管理](./env-management.md) | dotenvx 加密方案、多环境密钥、新成员入职流程 |

---

## 仓库全景

### 双层级 monorepo

项目存在**两层**包管理结构：

```
walnut-admin/                        ← Turborepo + pnpm workspace（外层）
├── apps/
│   ├── admin/                       ← @walnut/admin（Vue3 SPA）
│   ├── server/                      ← @walnut/server（NestJS API）
│   │   ├── apps/api/                ← NestJS 应用入口
│   │   └── libs/                    ← NestJS CLI monorepo（内层，9 个 lib）
│   └── docs/                        ← @walnut/docs（VitePress 文档站）
├── packages/                        ← 共享库
│   ├── contract/                    ← @walnut/contract（类型 + 常量）
│   ├── utils/                       ← @walnut/utils（纯函数工具）
│   ├── client/                      ← @walnut/client（浏览器工具 + Vue composables）
│   ├── axios/                       ← @walnut/axios（HTTP 客户端框架）
│   └── eslint-config/               ← @walnut/eslint-config（共享 ESLint 预设）
├── turbo.json                       ← 任务定义 + 缓存 + 架构边界
├── pnpm-workspace.yaml              ← workspace 声明 + catalog + overrides
├── tsconfig.base.json               ← 前端 ESM 基线（server 不继承）
├── eslint.config.mjs                ← 根 ESLint 入口
└── knip.config.ts                   ← 死代码检测配置
```

**外层**（Turborepo 层面）：`apps/*` + `packages/*` 共 8 个 workspace 包，通过 pnpm workspace 协议（`workspace:*`）相互引用。

**内层**（Server 内部）：`apps/server/libs/*` 下的 9 个 NestJS 内部库，通过 TypeScript `paths` 映射解析，不走 pnpm workspace。命名空间为 `@walnut-server/*`，与外层 `@walnut/*` 物理分离。

### 关键设计决策

1. **异构 Toolchain**：前端 ESM + Vite + `moduleResolution: "bundler"`；后端 CJS + NestJS CLI + SWC + `moduleResolution: "node"`。Server **不继承** `tsconfig.base.json`。
2. **两个命名空间**：`@walnut/*`（外层，pnpm workspace 包）和 `@walnut-server/*`（内层，NestJS internal libs）。物理分离，无命名冲突。
3. **catalog 统一版本**：260+ 依赖通过 `pnpm-workspace.yaml` 的 `catalog:` 统一定义，`catalogMode: strict` 阻止直接版本号。
4. **hoisting: false**：严格依赖隔离——每个包只能 import 自己声明的依赖。仅 5 个工具链例外被提升。

---

## 共享包体系

### 依赖图

```
@walnut/contract          ← 零依赖基础层（类型 + 常量）
    ↑
@walnut/utils             ← 纯函数工具（依赖 contract）
    ↑
@walnut/client  @walnut/axios   ← 浏览器/Vue 层（依赖 utils + contract）
    ↑              ↑
@walnut/admin             ← 消费所有共享包
```

### 各包职责

| 包 | 职责 | 框架依赖 |
|----|------|---------|
| `@walnut/contract` | 共享类型、DTO、枚举、API 契约 | 零依赖 |
| `@walnut/utils` | 纯函数（regex、queue、crypto） | 零框架依赖 |
| `@walnut/client` | 浏览器工具 + Vue composables | Vue 3 |
| `@walnut/axios` | HTTP 客户端框架（instance + adapters） | axios |
| `@walnut/eslint-config` | ESLint 共享预设（vue / nest / base） | ESLint |

### 消费方式

- **前端**（Vite）：通过 `workspace:*` symlink 直接消费源码（JIT 模式）
- **后端**（NestJS）：通过 `workspace:*` symlink 消费 CJS 构建产物（`exports` 的 `require` 条件）
- **不发布** npm：当前为内部 monorepo，`private: true` 已移除但暂不公开发布

---

## 后端内部库体系

Server 内部通过 NestJS CLI + SWC 管理 9 个内部库，命名空间 `@walnut-server/*`：

```
apps/server/libs/
├── config/       @walnut-server/config       — 环境配置 + 验证
├── const/        @walnut-server/const        — 常量 + 错误码
├── context/      @walnut-server/context      — ALS 上下文
├── db/           @walnut-server/db           — Mongoose + 事务
├── decorators/   @walnut-server/decorators   — 自定义装饰器体系
├── exceptions/   @walnut-server/exceptions   — 异常 + 全局过滤器
├── pipes/        @walnut-server/pipes        — 参数管道
├── types/        @walnut-server/types        — 类型声明
└── utils/        @walnut-server/utils        — 工具函数
```

这些 lib 通过 `apps/server/tsconfig.json` 的 `paths` 映射解析，由 NestJS CLI + SWC 统一编译。它们**不参与** pnpm workspace，不通过 `package.json` `exports` 消费。

---

## 相关 ADR

- [ADR-0010: No TypeScript Project References](/content/adr/0010-no-ts-project-references.md)
- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release.md)
- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)
