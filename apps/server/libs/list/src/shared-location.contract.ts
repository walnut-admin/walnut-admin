/**
 * 归属地三字段（country / region / city）的**跨层一致性守卫**（编译期）。
 *
 * 背景：拆层后这个形状有两处声明，而两侧**不能互相 import** ——
 * - `SharedLocationDTO`（本 lib，tech-assemble）是 wire 面的真源：装饰器决定校验、转换与
 *   swagger 元数据；
 * - `ISharedIpLocationCore`（`@walnut-server/ip`，tech-base）是数据面的真源：IP 解析器
 *   返回的实际对象形状。
 * base → assemble 是 F-14 禁止的反向边（eslint 会红），所以 `libs/ip` 只能就地声明同型
 * 三字段；下沉到 `libs/types` 也不行 —— 那一层按契约只有全局 `.d.ts` 声明（无运行时、
 * 无装饰器），放不下带装饰器的 DTO 类。
 *
 * 于是把「两侧必须同型」从注释里的口头约定变成机械守卫：本文件一旦不成立，
 * `types:check` 直接红（`Assert<false>` 不满足 `T extends true` 约束）。
 *
 * 为什么落在 list 侧：assemble → base 是合法方向（`libs/ip` 反过来引本文件会红）。
 *
 * 覆盖的漂移：任一侧把 country / region / city 改名、删掉、或改类型（如 `string` →
 * `string | undefined`）。**新增**字段不会红 —— 那是有意的：wire 侧新增可选字段不需要
 * 数据面同时产出，而数据面要新增字段时必须同步 wire 声明（由 ip 侧的 `ISharedIpLocationCore`
 * 变更触发本守卫变红）。
 */
import type { ISharedIpLocationCore } from '@walnut-server/ip'
import type { SharedLocationDTO } from './device-geo.dto'

/** 编译期断言：T 必须是 `true` —— `false` / `never` 都会让 `types:check` 红在这里 */
type Assert<T extends true> = T

/** 双向可赋值才算「同型」：`string` 与 `string | undefined` 会判 false */
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export type WalnutAdminSharedLocationContract
  = & Assert<SameType<SharedLocationDTO['country'], ISharedIpLocationCore['country']>>
    & Assert<SameType<SharedLocationDTO['region'], ISharedIpLocationCore['region']>>
    & Assert<SameType<SharedLocationDTO['city'], ISharedIpLocationCore['city']>>
