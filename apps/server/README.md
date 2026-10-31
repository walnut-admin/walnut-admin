# `@walnut/server` — Walnut Admin 后端

NestJS 12 + SWC + PostgreSQL（TypeORM）+ Redis。**内部 Nest CLI monorepo**：`apps/api/` 与 `libs/` 不是 pnpm
workspace 包，靠 `apps/server/tsconfig.json` 的 paths（`@walnut-server/*`）解析，与 app 一起由 SWC 编译。

> 为什么不做成 workspace 包：见 [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)
> （CJS + NestJS 耦合 + SWC 编译，不适合当 ESM 包）。

| 想看什么 | 去哪 |
|----------|------|
| Agent 入口 / 导航 | [`AGENTS.md`](./AGENTS.md) |
| 后端全部规矩（模块结构、三种 Repository 模式、DTO 与装饰器、Guard 顺序） | [`CLAUDE.md`](./CLAUDE.md) |
| 未整理的草稿待办（原 server 仓遗留，**不是**当前 backlog） | [`TODO.md`](./TODO.md) |
| 当前架构 backlog | [架构待办事项](../docs/src/zh-CN/content/monorepo/architecture-todo.md) |

## 目录

```
apps/server/
├── apps/api/src/     默认部署单元：应用入口、组合根、wire DTO 与 controller
├── apps/api/migrations/  TypeORM 迁移（结构演进只经 migration:run）
├── apps/worker/src/  可选第二进程（cron + Bull，默认部署不启动；见 apps/worker/README.md）
├── apps/cli/src/     工具入口（migration 数据源 / OpenAPI 导出）
├── libs/*/src        内部库（按依赖方向分五层，完整清单以目录为准；见 ADR 0022）
├── db/seed/          初始化数据（每个集合一个 JSON 数组，db:seed:pg 消费）
├── infra/nest/       nest-cli 构建配置（dev / stage / prod）
├── infra/swc/        SWC 编译配置
├── env-encrypted/    密文（随仓库提交，dotenvx；文件内注释即模板）
├── env-local/        明文 env（由 `pnpm setup-env` 生成，gitignored）
├── .data/            运行态 Cap.js token 存储（gitignored；停服务后可删）
├── docker/           本地开发 compose（PostgreSQL + Redis）
└── Dockerfile        后端镜像构建
```

## 环境要求

- Node.js >= 24.13.0
- **PostgreSQL**（单节点即完整 ACID；本地 compose 用 `postgres:18-alpine`）
- **Redis 7+**（本地 compose 用 `redis:8-alpine`）

## 快速开始

```bash
# 1) 仓库根：解密 env（需要根 .env.keys）
pnpm setup-env

# 2) apps/server：起本地依赖（PostgreSQL + Redis，需 Docker）
docker compose -f docker/docker-compose.dev.yml up -d

# 3) apps/server：建表（应用启动不自动跑迁移）
pnpm migration:run

# 4) 仓库根：播初始化数据（幂等，重复跑安全）
pnpm db:seed:pg

# 5) apps/server：起服务（必须从该目录运行，ConfigModule 用 process.cwd() 定位 env）
pnpm dev            # nest start api --watch -c infra/nest/dev.json
```

API 文档（Scalar API Reference）：<http://localhost:3000/api>

## 常用命令

在 `apps/server/` 下运行：

```bash
pnpm dev            # 开发（watch；静态资源随 assets 拷入 dist）
pnpm build          # 生产构建（末尾校验 dist 的 i18n/public/views 资产）
pnpm build:stage    # stage 构建（同上，dist-stage）
pnpm start:prod     # 直接跑产物
pnpm lint           # ESLint（fix: pnpm lint:fix）
pnpm types:check    # tsc --noEmit --pretty
pnpm test           # vitest
pnpm test:cov       # 覆盖率
```
