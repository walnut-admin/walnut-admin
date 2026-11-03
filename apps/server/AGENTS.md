# Walnut Admin NestJS Server - Agent Guide

> 本包（`apps/server/`）的 **agent 入口**，也是本目录的**唯一真源** —— 按
> [AGENTS.md 约定](https://agents.md/)，agent 读的是**离被改文件最近**的那份指引。
> [`CLAUDE.md`](./CLAUDE.md) 只有一行 `@AGENTS.md` 导入，**别往它里面写内容**（Claude Code 在两者
> 并存时默认只读 `CLAUDE.md`，那行导入是它拿到本文件的唯一路径）。
>
> **本文件只放每次会话都要进上下文的规矩**（官方建议单个指引 ≤200 行）；参考型细节在文档站「后端」
> 五篇里，找不到某个旧小节就去那边按标题找 —— **别把参考内容搬回来**。
>
> 历史一句话：本文件曾是 14 行索引（14 条链接全失效），并入的原 `CLAUDE.md`（537 行）于 2026-09-23
> 拆成「本文件常驻规矩 + 文档站五篇」，此后再未回填。

## 先看哪份

| 想看什么 | 去哪 |
|----------|------|
| **后端规范全文**（目录与模块骨架、Entity 注册与仓库基类、DTO 全部示例、装饰器顺序、事务、环境配置、代码风格） | 文档站「后端」五篇（repo 相对路径，能直接打开）：`apps/docs/src/zh-CN/content/backend/architecture.md` · `dto.md` · `transactions.md` · `configuration.md` · `code-style.md` |
| **Repository 与 Shared Service** —— 改后端代码前必读，最容易做错的一条 | 本文件下面「Repository 与 Shared Service（两种形态，一个判据）」 |
| **Guard 执行顺序** —— 动 controller 之前必读 | 本文件下面「Security Guard 执行顺序」 |
| 全仓结构、命令、提交纪律 | 仓库根 [`AGENTS.md`](../../AGENTS.md) |
| 架构决策（为什么后端 lib 不提升为 workspace 包、lib 分层与组合根、工具链分叉） | [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md) · [ADR 0022](../docs/src/zh-CN/content/adr/0022-backend-lib-layering-and-composition-roots.md) · [ADR 0012](../docs/src/zh-CN/content/adr/0012-toolchain-divergence.md) |
| 可复用的后端开发技能 | [`.claude/skills/`](../../.claude/skills/) 下 `be-*` 前缀（建模块 / 加字段 / 加接口 / 自查 / 评审） |

## 这个包是什么

NestJS 12.x + TypeScript 6.0.3 + PostgreSQL（TypeORM）+ Redis + Bull 队列的中后台后端模板，是
**内部 Nest CLI monorepo**，不是 pnpm workspace 包：

- `apps/api/src/` —— 默认部署单元（组合根）：HTTP 入口、`AppModule`、wire DTO 与 controller
- `apps/worker/src/` · `apps/cli/src/` —— 可选组合入口（cron + Bull；migration / OpenAPI），默认部署不启动 worker
- `libs/*/src` —— 内部库（按依赖方向分六层；技术层分 tech-base / tech-assemble 两条 layer，完整清单以 `libs/` 目录为准），
  经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译
- 为什么这样：[ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)
  （CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）· [ADR 0022](../docs/src/zh-CN/content/adr/0022-backend-lib-layering-and-composition-roots.md)
  （分层、组合根、端口注入反转）

**主要能力**：多认证（JWT、OAuth、WebAuthn、OPAQUE）、RBAC、MFA、实时通信（WebSocket/SSE）、i18n、
完整安全体系（IP / 设备 Guard、CAPTCHA、风险评估、XSS 防护）。**源码不在** `src/walnut/admin/com/app/`
（三仓合并前的废弃路径）。

## 命令（注意 cwd）

后端的**裸** `pnpm dev` / `pnpm test` 只能在 `apps/server/` 下跑（ConfigModule 用 `process.cwd()`
定位 env）；从仓库根起后端用 `pnpm dev:server`（= `turbo dev --filter=@walnut/server`，turbo 在
`apps/server/` 下执行，cwd 正常）。

- 本目录：`pnpm dev`（nest start api --watch）· `pnpm build` / `build:stage` · `pnpm start:prod` /
  `start:stage` · `pnpm lint`（fix: `lint:fix`）· `pnpm types:check`（strict）/ `typecheck:watch` ·
  `pnpm test` / `test:watch` / `test:cov` / `test:e2e`
- 仓库根：`pnpm install` · `pnpm setup-env` · `pnpm dev:server` · `pnpm test`（只跑后端
  `pnpm --filter=@walnut/server test`）

其余脚本见 `apps/server/package.json`。

## 跑起来需要什么

- **PostgreSQL**（单节点即完整 ACID，事务不再对拓扑有要求；本地用
  `apps/server/docker/docker-compose.dev.yml` 起库）+ **Redis 7+**
- 环境文件：`pnpm setup-env` 解密后落在 `apps/server/env-local/`（gitignored）
- Node / pnpm 版本门槛与安装约束见仓库根 `AGENTS.md`

开发模式下 Scalar API Reference 在 `http://localhost:3000/api`。

## Repository 与 Shared Service（两种形态，一个判据）

| 形态 | 文件落点 | `@Global` | 业务逻辑 | 事务句柄 `em` | 用在哪 |
|------|----------|-----------|----------|---------------|--------|
| **Repository** | 同模块 CRUD：`*.basic.repository.ts`；跨模块：`repo/*.repo.service.ts` + `*.repo.module.ts` | **仅当消费方模块 ≥ 2** | 无（纯 CRUD） | 经装饰器 / 最后一个可选参数 | 全部数据访问 |
| **Shared Service** | `shared/*.shared.service.ts` | 否（模块同时承担 `WALNUT_ADMIN_*` 端口绑定时例外，ADR 0022 D3） | **有**（缓存、编排） | 最后一个可选参数 | 复杂业务逻辑 |

调用链只有一条：`Controller → Service`（与 Controller 1:1）→ Repository / Shared Service → Entity。
**硬规矩**：controller 级的 `*.service.ts` **不许**直接做数据访问（自己注入 `DataSource` 拿
Repository 也算）—— 所有数据访问必须穿过 Repository。

**落点怎么选**：只在本模块用 → `*.basic.repository.ts`（跟着模块走，不建额外 module）；被别的
模块用 → `repo/` 落点。**`@Global` 只有一个判据：消费方模块数 ≥ 2**（数「声明了注入该 repository
的类」的模块，不是数文件、不是数调用点）：= 1 时**不许** @Global —— 它只会把真实依赖从 imports
图上抹掉，由拥有者模块显式 import；≥ 2 才允许，并在模块头注释登记理由。判据 + 「非 @Global 的
每个消费方都能经 imports 看见它」由 `apps/api/src/common/monorepo/repo-global.drift.spec.ts`
机械守（跑单测即校验）。

**实体注册**在模块 `imports` 里：`TypeOrmModule.forFeature([XxxEntity], WalnutPGConnectionName)`
（`autoLoadEntities` 通道），**不另建 xxx.pg.module 文件**；仓库层注入
`@InjectDataSource(WalnutPGConnectionName)` 的 `DataSource` 连同 `EntityTarget` 传给 PG 基类
`WalnutAdminCommonPgBaseRepository`，**连接名必须显式给 `WalnutPGConnectionName`**（不走 TypeORM
默认连接）；事务内用 `@WalnutTxSession()` 取 `WalnutTxContext.em` 逐层透传。完整写法见
`apps/docs/src/zh-CN/content/backend/architecture.md` · `transactions.md`。

## CRUD 与 DTO：动手前必须知道的两条

1. **DTO 包装只用项目的**：`@walnut-server/utils/dto` 的 `RealPickType` / `RealPartialType`，
   **绝不用** NestJS 原生 `PickType` / `PartialType` —— 全局 `ClassSerializerInterceptor` 开了
   `excludeExtraneousValues: true`，原生版本不补 `@Expose()` ⇒ 字段被**静默**过滤掉（200 但字段消失）。
2. **DTO 字段不写 `?` 与 `!`**：必填性只有一个真源 —— 字段装饰器的 `default`（可选字段写 `default: null`）；
   类型标记会造出第二个真源，两者必然漂移。

CRUD 装饰器由 `WalnutCrudDecorators({ title, DTO })` 工厂生成（`@walnut-server/crud`）；DTO 字段用
`@walnut-server/decorators/field` 的装饰器，**不要裸写 class-validator**。全部示例、以及**会被 ESLint
强制**的装饰器顺序见 `apps/docs/src/zh-CN/content/backend/dto.md`。

## Security Guard 执行顺序

在 `app.module.ts` 的 `APP_GUARD` 数组里**从上到下**装配，即执行顺序（动 controller 前必读）：

**IP**（IP 黑名单）→ **Security**（UserAgent、黑名单路径、bot）→ **Device**（Cookie 取设备）→
**Risk 认证前** → **CAP 认证前** → **JWT**（认证）→ **Risk 认证后** → **CAP 认证后** → **MFA** →
**Sign**（请求签名，必须在 JWT 之后：登录前后规则不同）→ **Lock**（用户锁定，必须在 JWT 之后）→
**Throttler**（限流，注册在 `techniques/tech.module.ts` 的 `APP_GUARD`，排 Lock 之后）。

定义在 `apps/server/apps/api/src/app/app.module.ts`（第 12 位在 `tech.module.ts`）。注意该文件自己的
注释：**controller 装饰器上的顺序是反的**（自下而上）。

**改这个顺序必须同步 `apps/server/apps/api/src/common/monorepo/guard-order.drift.spec.ts`**：
它按「模块扫描序 × providers 数组序」把 APP_GUARD 摊平后与那份 12 元黄金序列逐位比对，
只改装配不改它必红，只改它不改装配则是自欺（顺序的真源是装配，不是 spec）。

## 环境变量：部署后不许改的 5 个

`AUTH_OPAQUE_SECRET`（OPAQUE 协议密钥）· `MFA_ENCRYPTION_KEY`（MFA 数据）· `RT_ENCRYPTION_KEY`
（refresh token）· `DEVICE_ID_ENCRYPTION_KEY`（设备 ID）· `USER_ID_ENCRYPTION_KEY`（用户身份标识）
—— 它们是数据加密的根：改一次，用旧 key 加密的历史数据就**再也解不开**。

dotenvx 密文、`setup-env` / `encrypt-env`、加载哪几个 env 文件、CI 的 `ENV_KEYS` secret 见
`apps/docs/src/zh-CN/content/backend/configuration.md`。

## 测试

Vitest，配置在 `apps/server/apps/api/vitest.config.ts`（E2E 用 `vitest.config.e2e.ts`）。新增纯函数与
工具必须补测试。
