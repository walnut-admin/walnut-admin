/**
 * 前端**变换层 / 消费形态**（OpenAPI codegen 收尾批）—— 从 `api/response.d.ts` 迁移而来。
 *
 * 这里只剩 legitimately 不可从 server swagger 推导的响应形状，每条都注明「为什么推导不了」：
 * server 无 schema 或 schema 过松的端点在收尾批已补文档化并改用 `@walnut/api-types` 生成别名
 * （monitor/server、logger read、key/current、lang public、device initial、deps、ali sts、
 * sign aes-key、auth keys、webauthn options、security-tab2），**不要**再往本文件加可推导形状。
 */
import type { SystemMenu } from '@walnut/api-types'
import type { TreeNodeItem } from 'easy-fns-ts'
import type { RouteRecordRaw } from 'vue-router'
import type { IStoreApp, IStoreSetting, IStoreUser } from '@/store/types'

/**
 * `GET /auth/permissions` 响应的**变换层形态** —— 消费方：`core/index.ts` + `buildRoutes`。
 *
 * 为什么推导不了：wire 真源是生成的 `AuthCorePermissionsDTO`，但前端消费需要
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
 * security tab3 状态占位 —— 消费方：`views/me/tabs/security/tab3`（当前注释掉）。
 *
 * 为什么推导不了：当前无对应端点（视图里 `getSecurityTab3StatusAPI` 注释掉），
 * 纯前端占位形态，等 server 提供 schema 后再换成生成类型。
 */
export type MeSecurityTab3Status = Record<string, never>

/**
 * `GET /app/setting/public` 的 store 消费形态 —— 消费方：`store/modules/app/app-setting`。
 *
 * 为什么推导不了：真源是 `IStoreApp.SettingBackend`；生成 `AppSettingDTOPublicResponse`
 * 全字段必填，而 store 状态逐项 `Partial` hydrate —— 前端按「只关心自己消费的键」收窄，
 * 属消费形态而非 wire 形状。
 */
export type AppSettingPublic = IStoreApp.SettingBackend

/**
 * `GET /app/setting/private` 的 store 消费形态 —— 消费方：`store/modules/setting`。
 *
 * 为什么推导不了：真源是 `IStoreSetting.Scope`；server 该端点当前无 response schema，
 * store 侧是带 `initialized` 等前端状态的 Scope 形状。
 */
export type AppSettingPrivate = IStoreSetting.Scope

/**
 * 用户偏好（`GET /system/user/preference/read`）的 store 形态 —— 消费方：
 * `store/modules/user/user-preference`。
 *
 * 为什么推导不了：真源是 `IStoreUser.Preference.State` —— store 把路由/布局默认值、
 * 持久化状态与 wire 偏好合并成一个客户端状态树（fontSize 在 store 侧是普通 number，
 * layout 带本地默认值），不是响应的逐字段镜像。P3-13 修复后 server 生成
 * `SysUserPreferenceResponseDTO` 已可当作消费类型使用（fontSize 枚举不再是 never）。
 */
export type SystemUserPreference = IStoreUser.Preference.State

/**
 * ## 前端消费契约（wire 事实，不可从 swagger 推导，按裁决登记）
 *
 * 以下四条是 server 行为/端点面的既定取舍，前端按此消费；改契约需同步本段与
 * `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 对应条目的裁决记录：
 *
 * 1. **throttle 超限 = HTTP 200 + `body.code === 42900`**（P3-1，裁决 2026-10-28）——
 *    全站统一响应壳不为例外放行原生 HTTP 429；前端限流分支只认 `body.code`，
 *    `Retry-After` 头仍给出剩余秒数。
 * 2. **`GET /auth/permissions` 顶层 = 首根节点的 children**（P3-4，裁决 2026-10-28）——
 *    单根部署（seed 形态）下 `permissionMenuTree` / `permissionRouteTree` 的顶层即
 *    根 catalog 下第一层；单根无子级时顶层数组恒空（`indexMenuName` 同为空串）。
 *    P3-18 修复后多根部署 = 全部根的 children 按根序拼接（单根 wire 不变）。
 * 3. **role 没有 delete / deleteMany 端点**（P3-7，裁决 2026-10-28「角色不删」）——
 *    角色是权限链的稳定引用（`sys_user_role` / `sys_role_menu` / `current_role_id`），
 *    停用走 update status、解绑走 junction 调整；前端不得渲染删除入口。
 * 4. **setting 没有 delete / deleteMany 端点**（P3-26，裁决 2026-10-28「配置不删」）——
 *    配置行只能新增/修改（外加 `POST cache/refresh`）；按标准 CRUD 发 DELETE 会得到
 *    40400（路由不存在），前端不提供删除入口。
 */
