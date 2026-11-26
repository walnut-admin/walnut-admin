/**
 * `@walnut/api-types`（openapi-typescript 从 `apps/server/openapi.json` 的机械产出）与协议客户端
 * 之间的**类型桥**。
 *
 * 为什么要有这一层：`request<T>` / `root<T>` 过去完全靠调用方手写泛型，后端把响应体改名 / 改嵌套时
 * E2E 的类型检查不会红 —— 只有某条字段断言碰巧失败才会暴露。现在默认 `T` 从生成物的
 * `paths[路径][方法]` 推导，调用点仍可显式覆盖（`request<string>` / `root<SystemUser>`）。
 *
 * 两个边界：
 * - **纯类型，零运行时**：`import type` 在 Node 的类型剥离里直接消失，不新增构建步骤；
 * - 动态拼接的路径（含运行时 id，如 `${SystemRoutes.USER}/${id}`）在类型层对不上生成物，回落到
 *   `Record<string, unknown>` —— 关键端点用契约里的字面量常量就能命中生成类型。
 */
import type { paths } from '@walnut/api-types'

/** 协议客户端支持的方法（大写，与 fetch 的 method 同形） */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * `POST /system/user/list` 成功响应的 `data`（分页壳 `{ data, total }`）。
 *
 * P2-6 修复后生成物的路径级响应与真实 wire 同形（`data` 是**单个**分页壳对象，不再是
 * 「分页壳的数组」），所以这里直接走默认推导；`EndpointData` 负责剥掉响应壳的
 * `code` / `msg` 与可选性。
 *
 * 行类型是 server `SysUserDTOListResponse` 的 pick 子集
 * （id / userName / nickName / status / createdAt / updatedAt / roles_count）——
 * `roles` / `roleMode` 之类不在 list 行里，断言碰到会直接类型红；`nickName` 可为 null。
 */
export type SystemUserListPage = EndpointData<'/system/user/list', 'POST'>

/** `POST /system/role/list` 成功响应的 `data`（分页壳；行**不含** menus / deptIds —— 见 R2 发现） */
export type SystemRoleListPage = EndpointData<'/system/role/list', 'POST'>

/** `POST /system/menu/list` 成功响应的 `data`（分页壳；行带 meta 对象） */
export type SystemMenuListPage = EndpointData<'/system/menu/list', 'POST'>

/** `POST /app/setting/list` 成功响应的 `data`（分页壳） */
export type AppSettingListPage = EndpointData<'/app/setting/list', 'POST'>

/**
 * `POST /app/monitor/cache/list` 成功响应的 `data`（分页壳）。
 *
 * 行里的 `key` 是**去掉 `WALNUT_CACHE_` 前缀后的展示键**（`SYSTEM:LANGUAGE:PUBLIC_LIST`、
 * `APP:SETTING` …），不是 Redis 原始键 —— 缓存清空用例按它做等值过滤。
 */
export type AppMonitorCacheListPage = EndpointData<'/app/monitor/cache/list', 'POST'>

/** 生成物的路径表用小写方法名（`paths['/system/user/list']['post']`） */
type MethodKey<M extends HttpMethod> = Lowercase<M>

/** 某路径 + 方法的 200 操作对象；路径或方法不在生成物里就是 `never` */
type OperationOf<P extends string, M extends HttpMethod>
  = P extends keyof paths
    ? MethodKey<M> extends keyof paths[P]
      ? NonNullable<paths[P][MethodKey<M>]>
      : never
    : never

/** 操作对象的 JSON 响应壳（`{ data?, code?, msg? }`） */
type JsonBodyOf<Op>
  = Op extends { responses: { 200: { content: { 'application/json': infer Body } } } }
    ? Body
    : never

/**
 * 壳里的 `data`。生成侧把它标成可选（同一个 DTO 有时兼任入参），但**成功响应必然带 data** ——
 * 这是 E2E 走 `request` 的前提（非 20000 的壳在客户端已经抛错），所以这里去掉 optional。
 */
type DataOf<Body> = Body extends { data?: infer Data } ? NonNullable<Data> : never

type BodyOf<P extends string, M extends HttpMethod> = JsonBodyOf<OperationOf<P, M>>

/**
 * 某端点成功响应的 `data` 类型。
 *
 * 注意条件写成分发关闭的元组（`[T] extends [never]`）：直接用 `T extends never` 在 `T` 是
 * 未解析的泛型时会得到 `never` 而不是分支结果。
 */
export type EndpointData<P extends string, M extends HttpMethod>
  = [BodyOf<P, M>] extends [never]
    ? Record<string, unknown>
    : [DataOf<BodyOf<P, M>>] extends [never]
        ? Record<string, unknown>
        : DataOf<BodyOf<P, M>>
