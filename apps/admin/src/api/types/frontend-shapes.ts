/**
 * 前端**变换层 / 消费形态**（OpenAPI codegen 收尾批）—— 从 `api/response.d.ts` 迁移而来。
 *
 * 这里只剩 legitimately 不可从 server swagger 推导的响应形状，每条都注明「为什么推导不了」：
 * server 无 schema 或 schema 过松的端点在收尾批已补文档化并改用 `@walnut/api-types` 生成别名
 * （monitor/server、logger read、key/current、lang public、device initial、deps、ali sts、
 * sign aes-key、auth keys、webauthn options），**不要**再往本文件加可推导形状。
 */
import type { SystemMenu } from '@walnut/api-types'
import type { TreeNodeItem } from 'easy-fns-ts'
import type { RouteRecordRaw } from 'vue-router'
import type { IStoreApp, IStoreSetting, IStoreUser } from '@/store/types'

/**
 * `GET /auth/permissions` 响应的**变换层形态**（真源 = 消费方 `core/index.ts` +
 * `buildRoutes`）。wire 真源是生成的 `AuthCorePermissionsDTO`，但前端消费需要：
 * - `permissionMenuTree` 包装成 `TreeNodeItem<SystemMenu>[]`（menu store 的树形契约）；
 * - `permissionRouteTree` 是 `RouteRecordRaw[]`（server 下发的 `component` 是 string，
 *   喂不进 `buildRoutes` 的 RouteRecordRaw 联合类型，需在 `core` 里做映射）；
 * - `affixedTabs` / `internalIframeList` 是 store 侧的 tab / iframe 视图形状。
 */
export interface AuthPermissions {
  permissionMenuTree: TreeNodeItem<SystemMenu>[]
  permissionRouteTree: RouteRecordRaw[]
  permissionStrings: string[]
  keepAliveNames: string[]
  indexMenuName: string
  affixedTabs: IStoreApp.Tab.Item[]
  internalIframeList: { name: string, url: string, cache: boolean }[]
}

/**
 * `GET /system/user/me/security-tab2` 响应。server 装饰为 `DTO: null`（swagger 里 data
 * 是 null，实际返回本形状，端点自带 `// TODO should remove`）—— 文档层推导不了；
 * 已登记 DESIGN-ISSUES P3-12，消费方 = `views/me/tabs/security/tab2`。
 */
export interface MeSecurityTab2Status {
  totp: {
    status: boolean
    verified: boolean
  }
  webauthn: {
    status: boolean
    verified: boolean
  }
}

/**
 * security tab3 状态占位。当前无对应端点（视图里 `getSecurityTab3StatusAPI` 注释掉），
 * 纯前端占位形态，等 server 提供 schema 后再换成生成类型。
 */
export type MeSecurityTab3Status = Record<string, never>

/**
 * `GET /app/setting/public` 的 store 消费形态（真源 = `IStoreApp.SettingBackend`）。
 * 生成 `AppSettingDTOPublicResponse` 全字段必填，而 store 状态逐项 `Partial` hydrate ——
 * 前端按「只关心自己消费的键」收窄，属消费形态而非 wire 形状。
 */
export type AppSettingPublic = IStoreApp.SettingBackend

/**
 * `GET /app/setting/private` 的 store 消费形态（真源 = `IStoreSetting.Scope`）。
 * server 该端点当前无 response schema；store 侧是带 `initialized` 等前端状态的 Scope 形状。
 */
export type AppSettingPrivate = IStoreSetting.Scope

/**
 * 用户偏好（`GET /system/user/preference/read`）的 store 形态（真源 =
 * `IStoreUser.Preference.State`）。生成的 `SysUserPreferenceResponseDTO` 里
 * `fontSize: never`（server 枚举装饰数字自映射对象，见 DESIGN-ISSUES P3-13），
 * 整个生成 schema 不可当作消费类型。
 */
export type SystemUserPreference = IStoreUser.Preference.State
