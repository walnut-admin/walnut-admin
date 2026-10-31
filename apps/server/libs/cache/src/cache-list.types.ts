import type { IWalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import type { SortOrder } from '@walnut/contract'
import type { Dayjs } from 'dayjs'

/**
 * 缓存监控列表的**结构类型**（libs 解耦批 2）。
 *
 * `cache.service.list` 原先直接 import app 的 `AppMonitorCacheDTO` /
 * `AppMonitorCacheDTOListRequest` —— lib → app 反向依赖。DTO 是 app 的 swagger 契约
 * 载体（依赖 `@walnut-server/decorators` 与 `apps/api/src/common/dto/list.dto`），不适合
 * 搬进 lib；这里只留「list 实际消费的形状」，app 侧 DTO 结构上天然满足，controller 的
 * 传参与返回值无需改签名。
 */

/** 列表行：与 `AppMonitorCacheDTO` 的实例形状一致（逐字段同型） */
export interface IWalnutAdminCacheListRow {
  key: string
  valueBytes: number
  expire: number
  type: IWalnutAdminConstAppCacheType
  startTime: Dayjs
  expireTime: Dayjs | null
}

/** 排序项：与 `CreateWalnutAdminRequestListDTO` 生成的 SortDTO 兼容（order 即 contract 的 SortOrder） */
export interface IWalnutAdminCacheListSort {
  field: string
  order: SortOrder
}

/** 分页项：与 `WalnutAdminRequestListPageDTO` 兼容 */
export interface IWalnutAdminCacheListPage {
  page: number
  pageSize: number
}

/** `list` 的入参形状：与 `AppMonitorCacheDTOListRequest` 兼容 */
export interface IWalnutAdminCacheListRequest {
  sort: ReadonlyArray<IWalnutAdminCacheListSort>
  query: Partial<IWalnutAdminCacheListRow>
  page: IWalnutAdminCacheListPage
}
