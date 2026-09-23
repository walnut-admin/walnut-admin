# `@walnut/contract`

> 前后端共享的**类型与常量契约** —— 错误码、响应信封、API 路由、分页、i18n / 菜单 / 角色枚举、JWT payload、socket 事件、cookie 与 token 键名，一个事实只有一个家。

| | |
|---|---|
| 目录 | `packages/platform-any/contract` |
| 平台 / 运行时 | `platform: any` ｜ `type: contract` ｜ `runtime: none`（`package.json` 的 `walnut` 块） |
| 消费方式 | **双模**：前端 Vite 经 `source` / `import` 条件直读 `src/*.ts`（JIT）；后端经 `require` 条件拿 `dist/*.cjs`（`vite build` 产出）。见 [ADR 0002](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) |

## 它是什么

任何「前端也要知道」的常量与类型都放这里。消费方**直接 import，不做包装层**（[ADR 0004](../../../apps/docs/src/zh-CN/content/adr/0004-direct-contract-consumption.md)；`apps/admin/src/const/menu.ts`、`app.ts` 这类文件已退化成别名 / passthrough）。

**准入标准**（ADR 0017 原文）：**前后端都必须用到**；只有一方用的留在那一方。

边界：

- 只放**类型与常量** —— 没有函数、没有类。`dependencies` 里仅有 `easy-fns-ts`，且三处用法都是 `import type { ValueOf }`，实际零运行时依赖。
- 服务端专属的东西**不进这里**：角色 ID 常量（`RootId` / `SafeUserId` 等）与 Cookie 的 `__Secure-` / `__Host-` 前缀逻辑留在 server（见 `src/cookie.ts` 的文件注释）。
- 纯函数工具去 `@walnut/utils`，环境无关的类型体操去 `@walnut/types`。

## 导出面

`exports` 的 `"."` 与 `"./*"` **源 / 产物同构**：

```json
{
  "exports": {
    ".": { "source": "./src/index.ts", "types": "./src/index.ts", "import": "./src/index.ts", "require": "./dist/index.cjs", "default": "./dist/index.cjs" },
    "./*": { "source": "./src/*.ts", "types": "./src/*.ts", "import": "./src/*.ts", "require": "./dist/*.cjs", "default": "./dist/*.cjs" }
  }
}
```

`"."` 是 `src/index.ts` 的**选择性** barrel（无 `export *`，[ADR 0013](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md)）；子路径入口与源文件一一对应：

| 入口 | 内容 |
|------|------|
| `.` | 下列全部运行时值 + 类型 |
| `./cookie` | `WalnutAdminConstCookieKeys`（`DEVICE_ID` / `CAPJS_TOKEN` / `RT_JTI` / `SIGN_TICKET`） |
| `./crypto-wire` | `AES_GCM_WIRE`（`IV_LENGTH` / `TAG_LENGTH` / `MIN_PAYLOAD_LENGTH`） |
| `./http` | `RequestHeaders`（`X-Request-ID` / `X-Language` / `X-Sign` / `X-Fingerprint` …） |
| `./i18n` | `Locale` / `LocaleType` |
| `./menu` | `MenuType` / `MenuTernal` / `CacheKeyStrategy` |
| `./pagination` | `SortOrder` / `SortOrderValues` / `SortParam` / `BaseSortParams` / `BasePageParams` / `BaseListParams` / `BaseListResponse` |
| `./response` | `ResponseBase<T>`（`code` / `msg` / `data`，外加可选 `requestId` / `meta` / `_devMsg`） |
| `./response-code` | `WalnutAdminConstAppResponseCode` / `IWalnutAdminConstAppResponseCode` |
| `./role` | `Role` / `RoleType` |
| `./routes` | `AuthRoutes` / `SystemRoutes` / `SystemEndpointRoutes` / `AppRoutes` / `SecurityRoutes` / `SharedRoutes` |
| `./socket` | `WalnutAdminSocketEvents` / `WalnutAdminSocketRooms` |
| `./token` | `IWalnutAdminAccessTokenPayload` / `IWalnutAdminRefreshTokenPayload` / `IWalnutAdminTokenUser` |
| `./token-key` | `WalnutAdminConstAppTokenKey`（`ACCESS` / `REFRESH`） |

## 怎么用

```ts
// ① 前端 API 层：路由常量 + 响应码判成功（apps/admin/src/api 与 axios 拦截器的用法）
import type { ResponseBase } from '@walnut/contract'
import { AuthRoutes, WalnutAdminConstAppResponseCode } from '@walnut/contract'

export function isOk(res: ResponseBase<unknown>): boolean {
  return res.code === WalnutAdminConstAppResponseCode.SUCCESS
}

export const refreshUrl: string = AuthRoutes.REFRESH
```

```ts
// ② 后端：同一个包名，走 require / types 面（apps/server 里的用法）
import { RequestHeaders } from '@walnut/contract/http'
import { AES_GCM_WIRE } from '@walnut/contract/crypto-wire'
import { Role } from '@walnut/contract'

export function isRoot(role: string): boolean {
  return role === Role.ROOT
}

export const languageHeader: string = RequestHeaders.LANGUAGE
export const ivLength: number = AES_GCM_WIRE.IV_LENGTH
```

```ts
// ③ 分页契约：server DTO 与前端表格共用同一组形状
import type { BaseListParams, BaseListResponse, SortOrder } from '@walnut/contract'

export interface UserQuery {
  userName?: string
}

export type UserListParams = BaseListParams<UserQuery>
export type UserListResponse = BaseListResponse<{ id: string }>
export const defaultOrder: SortOrder = 'descend'
```

## 依赖与边界

- **依赖**：`easy-fns-ts`（仅 `import type`）。devDependencies 是构建 / 测试链：`vite` + `vite-plugin-dts` + `vitest` + `@walnut/vitest-config` + `@walnut/tsconfig`（`ts.json` 预设）。
- **消费者**：`@walnut/admin`、`@walnut/server`、`@walnut/http`（业务码 passthrough）、`@walnut/utils`（`src/crypto/const.ts` 引 `AES_GCM_WIRE`）。
- **边界由 turbo tags 强制**：workspace 级 `turbo.json` 声明 `shared` / `pure` / `platform-any`，根 `turbo.json` 的 `boundaries.tags` 给出两条规则 —— `shared` 不许依赖 `app`，`platform-any` 不许依赖 `platform-web` / `platform-node`（`pure` 是描述性标签，无对应规则）。由 `pnpm boundaries` 拦。
- **变更由快照守护**：`src/index.test.ts` 对公开 API 面、错误码、路由、wire format 等逐项 `toMatchSnapshot()`，静默改动会在 diff 里暴露。

## 已知限制与延后工作

- **路由常量在 server 侧 0 处消费**：admin 侧已大量使用，但 controller 仍写字面量路径，A5 记「剩余全在 server 侧」—— 证据：`apps/docs/src/zh-CN/content/monorepo/architecture-todo.md` 的 A5 条目。
- **8 个错误码标着 `// TODO not used yet`**（`REQUEST_TIMEOUT`、`TOO_MANY_REQUESTS` 及 `_RATE_LIMITED`、`INTERNAL_SERVER_ERROR_CACHE`、`INTERNAL_SERVER_ERROR_MQ`、`SERVICE_UNAVAILABLE_MAINTENANCE`、`GATEWAY_TIMEOUT`、`HTTP_VERSION_NOT_SUPPORTED`）—— 定义了但从未发出：`packages/platform-any/contract/src/response-code.ts`。
- **`IListRequestParams` 与 `BaseListParams` 结构重复，未收敛**：ADR 0017 的「需修复的问题」表要求 server 侧改用 contract 的 `BaseListParams` / `SortParam`，至今仍在原地 —— 证据：`apps/server/libs/utils/src/listAggregate.ts` 与 `apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md`。
- **CJS 产物面不是选择性 barrel**：`dist/index.cjs` 被 `packages/platform-any/contract/scripts/build-barrel.ts` 覆盖生成，对每个子模块做 `Object.keys(...).forEach(k => exports[k] = ...)` 的**通配**聚合 —— 与 ADR 0013「包入口不用 `export *`」的形态不一致（源面是选择性 barrel，产物面不是）。
- **缺「dist 过期」检测**：改了 `src/` 忘了 `pnpm build`，后端 `require` 到的仍是旧 CJS。D3 记为「维持双模 + 补一道检测（倾向先 (a) + 检测）」，尚未裁决 —— 证据：`apps/docs/src/zh-CN/content/monorepo/architecture-todo.md` 的 D3 条目。
- **ADR 0017 判定「进 contract」的内容未迁完**：`DeviceTypeConst` / `SharedUserAgentDTO` 的纯类型仍在 `apps/server/apps/api/src/common/dto/shared.dto.ts`；`otpType` / `OtpIdentityTypeMap` 当时记为「待确认，暂不进」—— 证据：`apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md`。

## 相关

- [架构地图 · 共享包体系](../../../apps/docs/src/zh-CN/content/monorepo/architecture.md)（依赖图 / 各包职责 / 消费方式）
- [架构待办事项](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)（A5 路由迁移、D3 源码面 / 产物面）
- ADR：[0002 双模式消费](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) ｜ [0004 直接消费 contract](../../../apps/docs/src/zh-CN/content/adr/0004-direct-contract-consumption.md) ｜ [0005 JIT vs 构建](../../../apps/docs/src/zh-CN/content/adr/0005-jit-vs-build.md) ｜ [0013 Barrel 策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md) ｜ [0017 包重组](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- 兄弟包：[`@walnut/utils`](../utils-core/README.md) ｜ [`@walnut/types`](../types/README.md)
