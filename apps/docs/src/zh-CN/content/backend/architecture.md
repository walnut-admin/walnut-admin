# 后端架构与模块结构

> 本文是后端常驻指引 `apps/server/AGENTS.md` 的**参考部分**。改后端代码前请先读那份 ——
> Repository 三模式、DTO 的两条硬规矩、Guard 执行顺序都在那里；本文补齐它放不下的目录结构、
> 模块骨架与 Entity 注册细节。

## 应用与内部库

后端是 **NestJS 12 + SWC + PostgreSQL（TypeORM）**，形态是**内部 Nest CLI monorepo**，不是 pnpm workspace 包：

- `apps/api/src/` —— 默认部署单元（组合根）：HTTP 入口（`main.ts`）、`AppModule`、wire DTO 与 controller
- `apps/worker/src/` —— 可选第二进程（cron + Bull 消费，无 HTTP 监听；默认不启动）
- `apps/cli/src/` —— 工具入口（TypeORM migration 数据源、离线 OpenAPI 导出）
- `libs/*/src` —— 内部库（分六层；技术层在 `eslint.config.ts` 里拆 tech-base / tech-assemble 两条 `layer`，完整清单以目录为准），经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译

**源码不在** `src/walnut/admin/com/app/` —— 那是三仓合并前的路径，已废弃。

为什么这些 lib 不提升为 workspace 包（CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）：
见 [ADR 0007 后端内部库不参与 workspace](../adr/0007-backend-libs-not-workspace.md)。
分层、组合根与 worker/cli 的定位见 [ADR 0022 后端领域 lib 分层与组合根形态](../adr/0022-backend-lib-layering-and-composition-roots.md)。
工具链为什么与前端分叉，见 [ADR 0012 前后端工具链分歧](../adr/0012-toolchain-divergence.md)。

## 目录结构

```
apps/api/src/                          # 默认部署单元，入口 main.ts
├── app/                               # 根模块与根控制器（app.module.ts：全局 Guard 按序装配；
│                                      #   schedule.composition.ts：cron 归属的条件组合）
├── modules/                           # 各域 HTTP 组合根 + wire DTO（见下表）
├── decorators/                        # 仅剩 log.auth / log.operate（其余在 libs/guards / libs/crud）
├── common/                            # 共享 DTO、响应模型基座、数据权限实体注册表（仓库基类在 libs/repository）
├── i18n/                              # 国际化（zh_CN、en_US）
├── middleware/                        # 中间件
├── socket/                            # WebSocket 网关
├── public/ · views/                   # 静态资源与模板
└── ...

apps/worker/src/                       # 可选第二进程（同一镜像，默认部署不启动）
├── main.ts                            # createApplicationContext（无 HTTP）+ enableShutdownHooks
└── worker.module.ts                   # 组合根：AppModule + ScheduleModule（standalone 时）

apps/cli/src/                          # 纯工具入口（零运行时影响）
├── data-source.cli.ts                 # migration CLI 的 -d 数据源
└── export-openapi.ts                  # 离线导出 openapi.json（openapi:export）

libs/*/src/                            # 内部库，分六层，经 tsconfig paths 以 @walnut-server/* 解析
├── # 基建（9）
│   config/  const/  context/  db/  decorators/  exceptions/  pipes/  types/  utils/
├── # 技术 · tech-base（14）
│   als/  blpath/  cookie/  crypto/  delay/  lock/  queue/  sse/
│   cache/  throttle/  mailer/  sms/  rsa/  ip/
├── # 技术 · tech-assemble（5）
│   repository/  list/  crud/  scope-resolver/  token/
├── # identity 内核（1）
│   identity/
├── # 领域域（3）
│   system/  auth/  security/
├── # 装配（1）
│   guards/
└── # app-domain（1）
    app-domain/

（分层与依赖方向由 eslint.config.ts 的 libs-boundary + 三个 drift spec 机械守；lib 之间另有
按层 no-restricted-imports 分层规则；app 侧只剩组合根、wire DTO 与 controller —— 见 ADR 0022）
```

`modules/` 下按职责分六组（数据面都在 libs，controller / wire DTO 按依赖方向留 app）：

| 目录 | 放什么 |
|------|--------|
| `app/` | app 域组合根（`AppAppModule` + monitor 的 user HTTP 组合与 wire DTO）；demo / error / key / logger / monitor / setting 的数据面与其余 controller 在 `libs/app-domain` |
| `auth/` | 认证 HTTP 组合根（controller + passport mixin guard）；数据面在 `libs/auth` |
| `security/` | 安全 HTTP 组合根（rsa / sign / cap / sensitive controller）；数据面在 `libs/security`（rsa 独立为 `libs/rsa`） |
| `shared/` | 只剩 `SharedModule` 聚合根；area / ali / mask 在 `libs/app-domain/shared`，welcome 在 `libs/auth`，ip / token / scopeResolver 在 `libs/ip`、`libs/token`、`libs/scope-resolver`，email/SMS 在 `libs/mailer`、`libs/sms` |
| `system/` | 系统管理（HTTP 组合根：role/menu/device/logs/dict 等 controller 与 user wire DTO；数据面在 `libs/system`、身份栈在 `libs/identity`） |
| `techniques/` | 基础设施（task、event、health、logger；cache/queue/throttle/SSE 等在 libs） |

### 认证与 MFA 强制口径

`mfa.guard` 对所有已登录、非 visitor 用户强制 `mfaSetup=true`（登录时固化进 AT payload），
未启用 MFA 的用户一律 `40114` 拒绝 —— 这是**安全立场设计，没有灰度开关**。settings 里的
`app.auth.mfa.methodsRequiredCount` 只调节单次验证需要几路通道，不会取消强制
（裁决记录见 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 的 P2-1）。

## 模块骨架

新建模块时按下表的骨架铺开（`optional` 的两层只有真有跨模块需求时才建）：

```
module-name/
├── module-name.module.ts              # 模块定义
├── module-name.controller.ts          # HTTP 路由
├── module-name.service.ts             # 业务逻辑（与 controller 1:1）
├── module-name.basic.repository.ts    # 基础 CRUD（继承基类）
├── dto/module-name.dto.ts             # 数据传输对象
├── entity/module-name.entity.ts       # TypeORM 实体
├── repo/                              # 跨模块数据访问（可选，@Global）
│   ├── module-name.repo.module.ts
│   └── module-name.repo.service.ts
└── shared/                            # 跨模块业务逻辑（可选，非 @Global）
    ├── module-name.shared.module.ts
    └── module-name.shared.service.ts
```

这两个可选层的取舍规则见 `apps/server/AGENTS.md` 的「三种 Repository 模式」一节 ——
**controller 级的 `*.service.ts` 不许直接触达数据层**，所有数据访问都要穿过 Repository 层。

## Entity 注册与仓库注入

实体经 `TypeOrmModule.forFeature` 在模块里注册（连接名必须显式给 `WalnutPGConnectionName`，
`autoLoadEntities` 通道装载实体，**不另建 xxx.pg.module 文件**）；仓库继承 PG 基类
`WalnutAdminCommonPgBaseRepository`，注入 `@InjectDataSource(WalnutPGConnectionName)` 的
`DataSource` 并连同 `EntityTarget` 传给 super，名字标签取 `@walnut-server/db` 的
`WalnutModelName` 常量。下面是标准形态（原文见
`apps/server/libs/app-domain/src/demo/demo.basic.repository.ts`，新模块照抄即可）：

```typescript
import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { AppDemoEntity } from './entity/demo.entity'

@Injectable()
export class AppDemoBasicRepository extends WalnutAdminCommonPgBaseRepository<AppDemoEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppDemoEntity, WalnutModelName.APP_DEMO, dataSource)
  }
}
```

模块侧的接线（同模块 `demo.module.ts` 原文）：

```typescript
import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysDeletedModule } from '@walnut-server/system'
import { AppDemoEntity } from './entity/demo.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName),
    SysDeletedModule,
  ],
  controllers: [AppDemoController],
  providers: [AppDemoBasicRepository, AppDemoService],
  exports: [AppDemoService],
})
export class AppDemoModule {}
```

**不要**省略连接名（那会落到 TypeORM 的默认连接），也不要在 controller 级 `*.service.ts` 里
自己注入 `DataSource` 触达数据 —— 那会绕过 Repository 三模式的分层约束。
