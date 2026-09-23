# Walnut Admin NestJS Server - Agent Guide

> 本包（`apps/server/`）的 **agent 入口**，也是本目录的**唯一真源**。按
> [AGENTS.md 约定](https://agents.md/)，agent 读的是**离被改文件最近**的那份指引 ——
> 改后端代码时，这份就是权威来源。
>
> [`CLAUDE.md`](./CLAUDE.md) 只有一行 `@AGENTS.md` 导入，**别往它里面写内容**（Claude Code 在
> 两者并存时默认只读 `CLAUDE.md`，那行导入是它拿到本文件的唯一路径）。
>
> ⚠️ **本文件只放每次会话都要进上下文的规矩**（官方建议单个指引 ≤200 行）。原 `apps/server/CLAUDE.md`
> 全文已按「常驻规矩 / 参考文档」拆开：**本文件各节 + 文档站「后端」新增的那几篇**合起来才是它的
> 全部内容，找不到某个旧小节时去那边按标题找（参考型细节不该再往本文件堆）。

## 先看哪份

| 想看什么 | 去哪 |
|----------|------|
| **后端规范全文**（目录与模块骨架、Model 注入、DTO 全部示例、装饰器顺序、事务、环境配置、代码风格） | 文档站「后端」新增页（repo 相对路径，能直接打开）：`apps/docs/src/zh-CN/content/backend/architecture.md` · `dto.md` · `transactions.md` · `configuration.md` · `code-style.md` |
| **三种 Repository 模式** —— 改后端代码前必读，最容易做错的一条 | 本文件下面「三种 Repository 模式」 |
| **Guard 执行顺序** —— 动 controller 之前必读 | 本文件下面「Security Guard 执行顺序」 |
| 全仓结构、命令、提交纪律 | 仓库根 [`AGENTS.md`](../../AGENTS.md) |
| 架构决策（为什么后端 lib 不提升为 workspace 包、为什么工具链与前端分叉） | [ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md) · [ADR 0012](../docs/src/zh-CN/content/adr/0012-toolchain-divergence.md) |
| 可复用的后端开发技能 | [`.claude/skills/`](../../.claude/skills/) 下 `be-*` 前缀（建模块 / 加字段 / 加接口 / 自查 / 评审） |

> 更早的历史：本文件曾是一份 14 行的文档索引，指向从未进过仓库的 `./.agents/docs/`（14 条链接
> 全部失效，2026-09-23 由 `pnpm lint:docs-refs` 抓出）；其后并入的原 `CLAUDE.md` 全文则太长
> （537 行），2026-09-23 按上述方式拆分。

## 这个包是什么

NestJS 11.x + TypeScript 6.0.3 + MongoDB（Mongoose）+ Redis + Bull 队列 —— 功能齐全的中后台后端模板。
**内部 Nest CLI monorepo**，不是 pnpm workspace 包：

- `apps/api/src/` —— app 的入口与源码（`modules/` `app/` `guard/` `decorators/` `common/` `i18n/` …）
- `libs/*/src` —— 内部库 `{config,const,context,db,decorators,exceptions,pipes,types,utils}`，
  经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译
- 为什么这样：[ADR 0007](../docs/src/zh-CN/content/adr/0007-backend-libs-not-workspace.md)
  （CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）

**主要能力**：多认证方式（JWT、OAuth、WebAuthn、OPAQUE）、RBAC、MFA、实时通信（WebSocket/SSE）、i18n、
完整的安全体系（IP / 设备 Guard、CAPTCHA、风险评估、XSS 防护）。

**源码不在** `src/walnut/admin/com/app/`（那是三仓合并前的路径，已废弃）。

## 命令（注意 cwd）

```bash
# 从**仓库根**运行
pnpm install        # 安装依赖（pnpm 专用，由 packageManager 字段 + corepack 强制）
pnpm setup-env      # 解密 env-encrypted/ → env-local/（需根 .env.keys）
pnpm dev:server     # 起后端（= turbo dev --filter=@walnut/server）
pnpm test           # 全仓测试；只跑后端：pnpm --filter=@walnut/server test

# 从 **apps/server/** 运行（ConfigModule 用 process.cwd() 定位 env，必须在这个目录）
pnpm dev              # nest start api --watch（Nest + 资源热重载）
pnpm build            # 生产构建（NODE_ENV=production）
pnpm build:stage      # 预发构建（NODE_ENV=stage）
pnpm start:prod       # 直接跑产物（node dist/apps/api/src/main.js）
pnpm start:stage      # 预发产物
pnpm lint             # ESLint（fix: pnpm lint:fix）
pnpm types:check      # tsc --noEmit --pretty（strict）
pnpm typecheck:watch  # 类型检查 watch
pnpm test             # Vitest
pnpm test:watch       # watch 模式
pnpm test:cov         # 覆盖率
pnpm test:e2e         # E2E（vitest.config.e2e.ts）
```

⚠️ 后端的 `pnpm dev` **不能**在仓库根跑 —— 根 `dev` 只起前端（`turbo dev --filter=@walnut/admin`）。

## 跑起来需要什么

- **Node.js >= 24.13.0**、**pnpm >= 12.0.0** —— 由 `packageManager` 字段 + corepack +
  `pnpm-workspace.yaml` 的 `engineStrict: true` 强制（旧的 `preinstall` 钩子在 2026-09-21 的
  pnpm 12 迁移里已移除）
- **MongoDB 副本集**（事务必需；单节点副本集也行：`rs.initiate()`）
- **Redis 7+**
- 环境文件：`pnpm setup-env` 解密后落在 `apps/server/env-local/`（gitignored）

Swagger UI：`http://localhost:3000/api`

## 三种 Repository 模式

| 模式 | 文件 | `@Global` | 业务逻辑 | dbSession | 用在哪 |
|------|------|-----------|----------|-----------|--------|
| **Basic Repository** | `*.basic.repository.ts` | 否 | 无（纯 CRUD） | 经装饰器 | controller 的 CRUD |
| **Repo Service** | `repo/*.repo.service.ts` | **是** | 无（简单 CRUD） | 最后一个可选参数 | 跨模块数据访问 |
| **Shared Service** | `shared/*.shared.service.ts` | 否 | **有**（缓存、编排） | 最后一个可选参数 | 复杂业务逻辑 |

```
Controller
    ↓
Service（与 Controller 1:1，绝不直接使用 Model）
    ↓
├── Basic Repository（简单 CRUD）
├── Repo Service（跨模块数据访问）
└── Shared Service（复杂业务逻辑）
    ↓
Model（Mongoose）
```

**硬规矩**：controller 级的 `*.service.ts` **不许**直接注入或使用 Model —— 所有数据访问必须穿过
Repository / Repo Service / Shared Service 之一。

**Model 注入**用 `@WalnutDBInjectModel(WalnutDBModelName.X)`（两者都来自 `@walnut-server/db`），
**不要**用 NestJS 原生的 `@InjectModel`；完整写法见
`apps/docs/src/zh-CN/content/backend/architecture.md`。

## CRUD 与 DTO：动手前必须知道的两条

1. **DTO 包装只用项目的**：`@walnut-server/utils/dto` 的 `RealPickType` / `RealPartialType`，
   **绝不用** NestJS 原生 `PickType` / `PartialType`。全局 `ClassSerializerInterceptor` 开了
   `excludeExtraneousValues: true`，原生版本不补 `@Expose()` ⇒ 字段被**静默**过滤掉（接口 200 但字段消失）。
2. **DTO 字段不写 `?` 与 `!`**：必填性只有一个真源 —— 字段装饰器的 `default`（可选字段写 `default: null`）。
   类型标记会造出第二个真源，两者必然漂移。

CRUD 装饰器由 `WalnutCrudDecorators({ title, DTO })` 工厂生成（`@/decorators/crud`）；DTO 字段用
`@walnut-server/decorators/field` 的装饰器，不要裸写 class-validator。全部示例、以及**会被 ESLint 强制**
的装饰器顺序，见 `apps/docs/src/zh-CN/content/backend/dto.md`。

## Security Guard 执行顺序

在 `app.module.ts` 的 `APP_GUARD` 数组里**从上到下**装配，即执行顺序：

1. **IP Guard** —— IP 黑名单
2. **Security Guard** —— UserAgent、黑名单路径、bot 检测
3. **Device Guard** —— 设备校验（从 Cookie 取）
4. **Risk Guard（认证前）** —— 认证前风险评估
5. **CAP Guard** —— 认证前人机验证
6. **JWT Guard** —— 认证
7. **Risk Guard（认证后）** —— 认证后风险评估
8. **CAP Guard** —— 认证后人机验证
9. **MFA Guard** —— 多因素认证
10. **Sign Guard** —— 请求签名校验（必须在 JWT Guard 之后：登录前后签名规则不同）
11. **Lock Guard** —— 用户锁定状态（必须在 JWT Guard 之后）

定义在 `apps/server/apps/api/src/app/app.module.ts`。注意该文件自己的注释：**controller 装饰器上的
顺序是反的**（自下而上）。

## 环境变量：部署后不许改的 5 个

`AUTH_OPAQUE_SECRET`（OPAQUE 协议密钥）、`MFA_ENCRYPTION_KEY`（MFA 数据）、`RT_ENCRYPTION_KEY`
（refresh token）、`DEVICE_ID_ENCRYPTION_KEY`（设备 ID）、`USER_ID_ENCRYPTION_KEY`（用户身份标识）
—— 它们是数据加密的根：改一次，用旧 key 加密的历史数据就**再也解不开**。

dotenvx 密文、`setup-env` / `encrypt-env`、加载哪几个 env 文件、CI 的 `ENV_KEYS` secret：
见 `apps/docs/src/zh-CN/content/backend/configuration.md`。

## 测试

Vitest，配置在 `apps/server/apps/api/vitest.config.ts`（E2E 用 `vitest.config.e2e.ts`）。
新增纯函数与工具必须补测试。

## API 文档

开发模式下 Swagger UI 在 `http://localhost:3000/api`。
