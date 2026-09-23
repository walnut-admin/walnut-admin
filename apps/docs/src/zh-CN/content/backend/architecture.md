# 后端架构与模块结构

> 本文是后端常驻指引 `apps/server/AGENTS.md` 的**参考部分**。改后端代码前请先读那份 ——
> Repository 三模式、DTO 的两条硬规矩、Guard 执行顺序都在那里；本文补齐它放不下的目录结构、
> 模块骨架与 Model 注入细节。

## 应用与内部库

后端是 **NestJS 11 + SWC + Mongoose**，形态是**内部 Nest CLI monorepo**，不是 pnpm workspace 包：

- `apps/api/src/` —— Nest CLI 的 app：应用入口（`main.ts`）与全部业务源码
- `libs/*/src` —— 内部库，经 tsconfig `paths` 以 `@walnut-server/*` 解析，与 app 一起由 SWC 编译

**源码不在** `src/walnut/admin/com/app/` —— 那是三仓合并前的路径，已废弃。

为什么这些 lib 不提升为 workspace 包（CJS + NestJS 耦合 + SWC 编译，不适合当 ESM workspace 包）：
见 [ADR 0007 后端内部库不参与 workspace](../adr/0007-backend-libs-not-workspace.md)。
工具链为什么与前端分叉，见 [ADR 0012 前后端工具链分歧](../adr/0012-toolchain-divergence.md)。

## 目录结构

```
apps/api/src/                          # Nest CLI 的 app，入口 main.ts
├── app/                               # 根模块与根控制器（app.module.ts：全局 Guard 按序装配在这里）
├── modules/                           # 业务模块（见下表）
├── decorators/                        # 应用级自定义装饰器
│   ├── crud/                          # CRUD 装饰器工厂 WalnutCrudDecorators
│   └── walnut/                        # 权限 / 角色 / 上下文 / 缓存 / 操作日志等
├── guard/                             # 全局 Guard（IP、Security、Device、Risk、Cap、MFA、Sign、Lock）
├── common/                            # 共享 DTO、Model 基类、Repository 基类
├── i18n/                              # 国际化（zh_CN、en_US）
├── interceptors/                      # 请求 / 响应拦截器
├── middleware/                        # 中间件
├── socket/                            # WebSocket 网关
├── public/ · views/                   # 静态资源与模板
└── ...

libs/*/src/                            # 内部库，经 tsconfig paths 以 @walnut-server/* 解析
├── config/                            # 环境配置
├── const/                             # 常量（权限、DB 名等）
├── context/                           # AsyncLocalStorage 请求上下文
├── db/                                # 数据库模块：连接、Model 注入、事务拦截器
├── decorators/                        # 可复用的字段 / 参数 / 查询 / 校验 / Swagger 装饰器
├── exceptions/                        # 自定义异常
├── pipes/                             # 管道
├── types/                             # 全局类型声明
└── utils/                             # 工具函数（含 DTO 包装 RealPickType / RealPartialType）
```

`modules/` 下按职责分六组：

| 目录 | 放什么 |
|------|--------|
| `app/` | 应用级模块（`demo`、`monitor`、`setting`） |
| `auth/` | 认证（JWT、OAuth、MFA、OTP） |
| `security/` | 安全（CAPTCHA、RSA、Sign、Risk） |
| `shared/` | 共享服务（email、SMS、token） |
| `system/` | 系统管理（user、role、menu、device、logs、dict） |
| `techniques/` | 基础设施（cache、queue、logger、SSE、socket） |

## 模块骨架

新建模块时按下表的骨架铺开（`optional` 的两层只有真有跨模块需求时才建）：

```
module-name/
├── module-name.module.ts              # 模块定义
├── module-name.controller.ts          # HTTP 路由
├── module-name.service.ts             # 业务逻辑（与 controller 1:1）
├── module-name.basic.repository.ts    # 基础 CRUD（继承基类）
├── dto/module-name.dto.ts             # 数据传输对象
├── schema/module-name.schema.ts       # Mongoose schema
├── repo/                              # 跨模块数据访问（可选，@Global）
│   ├── module-name.repo.module.ts
│   └── module-name.repo.service.ts
└── shared/                            # 跨模块业务逻辑（可选，非 @Global）
    ├── module-name.shared.module.ts
    └── module-name.shared.service.ts
```

这两个可选层的取舍规则见 `apps/server/AGENTS.md` 的「三种 Repository 模式」一节 ——
**controller 级的 `*.service.ts` 不许直接注入或使用 Model**，所有数据访问都要穿过 Repository 层。

## Model 注入

Model 一律经 `@walnut-server/db` 的 `WalnutDBInjectModel` 注入，名字取同包的 `WalnutDBModelName` 常量。
下面是标准形态（原文见 `apps/server/apps/api/src/modules/app/demo/demo.basic.repository.ts`，
新模块照抄即可）：

```typescript
import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { IAppDemoDocument, IAppDemoModel } from './schema/demo.schema'

@Injectable()
export class AppDemoBasicRepository extends WalnutAdminCommonBasicRepository<IAppDemoDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_DEMO)
    readonly dbModel: IAppDemoModel,
  ) {
    super(dbModel)
  }
}
```

**不要**直接用 `@nestjs/mongoose` 的 `@InjectModel`，也不要拿 `Model.name` 当注入 token ——
那会绕过 `WalnutDBConnectionName` 这条连接约束。
