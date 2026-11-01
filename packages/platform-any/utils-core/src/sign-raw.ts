/**
 * @description 签名原文构造（双端共用的参数化纯函数）。
 *
 * 拼接规则：`METHOD|PATH(含 query)|扁平化 body 排序串|timestamp=xxx|nonce=xxx|ua=xxx`
 * —— 与**服务端验证侧现行规则逐字节一致**（`apps/server/libs/guards/src/guards/sign.guard.ts`
 * 的旧 `buildSignRaw`），管理端生产侧按同一规则组装。
 *
 * 各 part 的口径：
 * - `method`：HTTP 方法，内部统一 `toUpperCase()`；
 * - `path`：**已剥离 API 前缀、不含 query** 的路由路径；空串按 `/` 处理；
 * - `query`：**已序列化**的查询串（不含前导 `?`）。生产端由 axios 的 paramsSerializer
 *   （qs, `arrayFormat: 'comma'`）产出，验证端直接用 `req.url` 的 query 原文 —— 序列化器
 *   属于 app 层配置，放在调用边界才能保证与真正发出的字节一致，故本函数不重造序列化；
 * - `body`：请求体对象/数组/原始值；`null` / `undefined` 按空对象处理，内部经
 *   `objectToPaths` 扁平化后按 key 排序、`k=v` 用 `&` 连接；
 * - `timestamp`：毫秒时间戳（数字），渲染为 `timestamp=${timestamp}`；
 * - `nonce`：32 位 hex 随机串；
 * - `ua`：User-Agent 原文（生产端 `navigator.userAgent`，验证端同名请求头）。
 */
import { objectToPaths } from './object-paths'

export interface SignRawParts {
  method: string
  /**
   * 已剥离 API 前缀、不含 query 的路径（含首 `/`）。调用方若拿到的 URL 自带
   *  `?query`（如 axios config.url 上直接写了 query），先用 `splitPathAndQuery` 拆开
   *  分别传入 `path` 与 `query`——否则会出现「path 含 ? 又拼 query」的双 ? 签名错位。
   */
  path: string
  /** 已序列化的查询串，不含前导 `?`；`undefined` 表示无 query */
  query?: string
  /** 请求体（对象/数组/原始值） */
  body?: unknown
  timestamp: number
  nonce: string
  ua: string
}

/**
 * @description 拆分 `url` 为 path + query 原文（不做解码/重新编码）。
 * 无 `?` 时 `query` 为 `undefined`；以 `?` 结尾时 `query` 为 `''`（保留尾随问号语义）。
 */
export function splitPathAndQuery(url: string): { path: string, query?: string } {
  const index = url.indexOf('?')

  if (index === -1)
    return { path: url }

  return { path: url.slice(0, index), query: url.slice(index + 1) }
}

/**
 * @description 剥离 `/{apiPrefix}/v{apiVersion}` 前缀（与 service 端旧实现同正则）。
 */
export function stripApiPrefix(path: string, apiPrefix: string, apiVersion: string | number): string {
  return path.replace(new RegExp(`^/${apiPrefix}/v${apiVersion}`), '') || '/'
}

/**
 * @description 构造签名原文（纯函数，双端逐字节同源）。
 */
export function buildSignRaw(parts: SignRawParts): string {
  const { method, path, query, body, timestamp, nonce, ua } = parts

  // 1. 扁平化 Request 体并排序
  const flattenObj = objectToPaths(body ?? {})
  const sortedParams = Object.keys(flattenObj)
    .sort()
    .map(k => `${k}=${flattenObj[k]}`)
    .join('&')

  // 2. 规范化路由路径（query 原文直接拼接；空路径回落 `/`）
  const normalizedPath = path || '/'
  const routePath = query === undefined ? normalizedPath : `${normalizedPath}?${query}`

  // 3. 组装签名原文（多因子）
  return [
    method.toUpperCase(), // HTTP 方法
    routePath, // 路由路径（含 query）
    sortedParams, // 请求参数（排序）
    `timestamp=${timestamp}`, // 时间戳
    `nonce=${nonce}`, // 随机数
    `ua=${ua}`, // User-Agent
  ].join('|')
}
