# `@walnut/server` — Walnut Admin 后端

NestJS 11 + SWC + Mongoose + Redis。**内部 Nest CLI monorepo**：`apps/api/` 与 `libs/` 不是 pnpm
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
├── apps/api/src/     应用入口与源码（modules / guard / decorators / common / config / const …）
├── libs/*/src        9 个内部库（config · const · context · db · decorators · exceptions · pipes · types · utils）
├── infra/nest/       nest-cli 构建配置（dev / stage / prod）
├── infra/swc/        SWC 编译配置
├── env-encrypted/    密文（随仓库提交，dotenvx；文件内注释即模板）
├── env-local/        明文 env（由 `pnpm setup-env` 生成，gitignored）
└── docker/           后端镜像相关
```

## 环境要求

- Node.js >= 24.13.0
- **MongoDB 副本集**（事务必需；单节点副本集也行：`rs.initiate()`）
- **Redis 7+**

## 快速开始

```bash
# 1) 在仓库根解密 env（需要根 .env.keys）
pnpm setup-env

# 2) 起服务：必须从 apps/server/ 运行（ConfigModule 用 process.cwd() 定位 env）
cd apps/server
pnpm dev            # nest start --watch
```

Swagger UI：<http://localhost:3000/api>

## 常用命令

在 `apps/server/` 下运行：

```bash
pnpm dev            # 开发（watch）
pnpm build          # 生产构建
pnpm build:stage    # stage 构建
pnpm start:prod     # 直接跑产物
pnpm lint           # ESLint（fix: pnpm lint:fix）
pnpm types:check    # tsc --noEmit --pretty
pnpm test           # vitest
pnpm test:cov       # 覆盖率
```
