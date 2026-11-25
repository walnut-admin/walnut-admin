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
import type { components, paths } from '@walnut/api-types'

/** 协议客户端支持的方法（大写，与 fetch 的 method 同形） */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * `POST` 的 `…/list` 分页壳（生成物里的 `*DTOSafeListResponse` 组件）。
 *
 * 为什么不直接用路径级默认推导：server 的 `libs/crud/src/list.ts` 把分页壳的 swagger schema
 * 写成了 `data: [分页壳]`（多包了一层数组），而真实 wire 是**单个**分页壳对象。E2E 的字段断言
 * 必须对着真实形状，所以这里显式取组件；组件本身仍来自生成物，字段改名照样会让 types:check 红。
 * 另注意生成物把行标成完整 `SysUserDTOSafe`，而 server 的 list 行实际是
 * `RealPickType(..., [id, userName, nickName, status, createdAt, updatedAt, roles_count])` 的
 * **子集** —— 断言只碰这些实际下发的字段（`roles` / `roleMode` / `gender` 不在 list 行里）。
 * 另外生成物把 `nickName` 标成 string，但新建用户的 list 行可能是 `null`（nullable 列）——
 * 别用 `typeof === 'string'` 判它，用「字段存在」级别的断言。
 * 这两处 schema 偏差都已作为发现记录，修 server swagger 不在 P1-4 的改动面内。
 */
export type SystemUserListPage = components['schemas']['SysUserDTOSafeListResponse']

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
