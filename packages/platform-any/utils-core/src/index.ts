/**
 * `@walnut/utils` 的包入口。
 *
 * 2026-11 批次 4 · D7 之后本包只剩**双端同源**的两件事（判据：两端是否对同一批字节 /
 * 同一棵树负责）：
 *   ① `sign-raw` —— 请求签名原文构造：前后端必须**逐字节**一致，各算各的必然漂移；
 *   ② `object-paths` —— 嵌套对象 ↔ 扁平 path：后端审计日志扁平化与前端扁平化是同一棵树。
 *
 * 其余（crypto 常量与 base64 转换器、regex、SingletonPromise、存储增强层）**后端 0 消费**，
 * 已下沉到 `@walnut/client`（`browser/crypto/{const,transformer}`、`regex`、`queue`、
 * `persistent/enhance/{sync,async}`）—— 它们不是「与后端共享的字节」，只是「前端单方面的工具」。
 */
export { objectToPaths, pathsToObject } from './object-paths'

export type { ObjectToPathsOptions, PathRecord } from './object-paths'

// 签名原文构造（双端逐字节同源）
export { buildSignRaw, splitPathAndQuery, stripApiPrefix } from './sign-raw'
export type { SignRawParts } from './sign-raw'
