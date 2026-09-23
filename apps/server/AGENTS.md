# Walnut Admin NestJS Server - Agent Guide

> 本包（`apps/server/`）的 **agent 入口**。按 [AGENTS.md 约定](https://agents.md/)，agent 读的是
> **离被改文件最近**的那份指引 —— 改后端代码时，这份 + [`CLAUDE.md`](./CLAUDE.md) 就是权威来源。

## 先看哪份

| 想看什么 | 去哪 |
|----------|------|
| **后端全部规矩**（模块结构、三种 Repository 模式、DTO/装饰器规则、Guard 顺序、环境变量） | [`CLAUDE.md`](./CLAUDE.md) —— 本目录下内容最全的一份，**改代码前先读它** |
| 全仓结构、命令、提交纪律 | 仓库根 [`AGENTS.md`](../../AGENTS.md) · [`CLAUDE.md`](../../CLAUDE.md) |
| 架构决策（为什么后端 lib 不提升为 workspace 包、为什么工具链与前端分叉） | [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md) · [ADR 0012](../docs/src/zh-CN/content/adr/0012-toolchain-divergence.md) |
| 可复用的后端开发技能 | [`.claude/skills/`](../../.claude/skills/) 下 `be-*` 前缀（建模块 / 加字段 / 加接口 / 自查 / 评审） |

> ⚠️ **历史说明**：本文件此前是一份 **14 行的文档索引**，指向 `./.agents/docs/01_PROJECT_OVERVIEW.md`
> 等 14 个文件 —— 而那个目录**从未进过仓库**，14 条链接**全部失效**（2026-09-23 由
> `pnpm lint:docs-refs` 一次性抓出）。内容职责已由 `CLAUDE.md` 与文档站承担，故改为上面这张导航表。

## 这个包是什么

NestJS 11 + SWC + Mongoose（**内部 Nest CLI monorepo**，不是 pnpm workspace 包）：

- `apps/api/src/` —— 应用入口与源码（`modules/` `guard/` `decorators/` `common/` `config/` `const/` …）
- `libs/*/src` —— 9 个内部库，经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译
- 为什么这样：见 [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)
  （CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）

**源码不在** `src/walnut/admin/com/app/`（那是三仓合并前的路径，已废弃）。

## 命令（注意 cwd）

```bash
# 从**仓库根**运行
pnpm setup-env      # 解密 env-encrypted/ → env-local/（需根 .env.keys）
pnpm dev:server     # 起后端（= turbo dev --filter=@walnut/server）
pnpm test           # 全仓测试；只跑后端：pnpm --filter=@walnut/server test

# 从 **apps/server/** 运行（ConfigModule 用 process.cwd() 定位 env，必须在这个目录）
pnpm dev            # nest start --watch
pnpm build          # 生产构建
pnpm types:check    # tsc --noEmit --pretty
```

⚠️ 后端的 `pnpm dev` **不能**在仓库根跑 —— 根 `dev` 只起前端（`turbo dev --filter=@walnut/admin`）。

## 跑起来需要什么

- **MongoDB 副本集**（事务必需；单节点副本集也行：`rs.initiate()`）
- **Redis 7+**
- 环境文件：`pnpm setup-env` 解密后落在 `apps/server/env-local/`（gitignored）

Swagger UI：<http://localhost:3000/api>
