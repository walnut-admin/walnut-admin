import { isNil } from 'lodash'

/**
 * list 分页入参的**唯一正规化口径**（批次 1 · P0 止血）。
 *
 * ## 为什么放在 `@walnut-server/utils` 而不是 `@walnut-server/repository`
 *
 * 分页上限是**契约常量**，被三条互不相干的链路消费，而这三条在不同层：
 *
 * 1. `libs/repository`（tech-assemble）—— DB 列表的 `LIMIT/OFFSET`；
 * 2. `libs/app-domain/logger`（最高层）—— 日志文件在内存里 slice；
 * 3. `libs/cache`（tech-base）—— Redis key 在内存里 slice。
 *
 * `cache` 是 tech-base、`repository` 是 tech-assemble（ADR 0022），
 * tech-base 反向 import tech-assemble 是分层违规 —— 所以常量必须落在两者共同的
 * 下层。`utils` 是基建层，三个消费者都合法可达。
 *
 * ## 它收掉的四个实测故障（R1 矩阵）
 *
 * | 入参 | 现状 | 本函数 |
 * |------|------|--------|
 * | `page.page = "abc"` | TypeORM 抛 `Provided "offset" value is not a number`（业务码 50000） | 回落 1 |
 * | `page = -1` | PG `2201X OFFSET must not be negative` | 回落 1 |
 * | `pageSize = -5` | PG `2201W LIMIT must not be negative` | 回落 10 |
 * | `pageSize = 0` | `LIMIT 0` 静默空页 | 回落 10 |
 * | `pageSize = 1e9` | 无上限（实测 `LIMIT 1000000000` 真发出去了） | 收到 9999 |
 *
 * 上限/缺省值与 list DTO 的声明同源（`libs/list/src/list.dto.ts:22,36`：
 * `min: 1` / `max: 9999` / `default: 1` / `default: 10`）。
 */

/** pageSize 上限 —— 与 `libs/list/src/list.dto.ts:36` 的 `max: 9999` 同源 */
export const WALNUT_LIST_PAGE_SIZE_MAX = 9999
/** pageSize 缺省 —— 与 `libs/list/src/list.dto.ts:32-42` 的 `default: 10` 同源 */
export const WALNUT_LIST_PAGE_SIZE_DEFAULT = 10
/** page 缺省 —— 与 `libs/list/src/list.dto.ts:18` 的 `default: 1` 同源 */
export const WALNUT_LIST_PAGE_DEFAULT = 1

export interface IWalnutNormalizedListPage {
  page: number
  pageSize: number
  skip: number
  limit: number
  /** 入参**给了值但被改写**（非数字 / <1 / 非整数 / 超上限）—— 缺省补默认值不算 */
  adjusted: boolean
}

/**
 * 分页入参正规化：`page` ≥ 1 且为整数、`pageSize` ∈ [1, 9999] 且为整数。
 * 非数字/越界一律回落默认值，**永不**抛 —— 调用方据此可记日志。
 */
export function normalizeListPage(page: unknown): IWalnutNormalizedListPage {
  const source = (isNil(page) ? {} : page) as { page?: unknown, pageSize?: unknown }

  const hasPage = !isNil(source.page)
  const hasPageSize = !isNil(source.pageSize)

  const rawPage = Number(source.page)
  const rawPageSize = Number(source.pageSize)

  const pageNumber = Number.isFinite(rawPage) && rawPage >= 1
    ? Math.trunc(rawPage)
    : WALNUT_LIST_PAGE_DEFAULT

  const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1
    ? Math.min(Math.trunc(rawPageSize), WALNUT_LIST_PAGE_SIZE_MAX)
    : WALNUT_LIST_PAGE_SIZE_DEFAULT

  const adjusted = (hasPage && rawPage !== pageNumber) || (hasPageSize && rawPageSize !== pageSize)

  return {
    page: pageNumber,
    pageSize,
    skip: (pageNumber - 1) * pageSize,
    limit: pageSize,
    adjusted,
  }
}
