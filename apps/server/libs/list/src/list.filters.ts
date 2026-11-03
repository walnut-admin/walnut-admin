import type { FilterOp } from '@walnut/contract'

/**
 * list 请求的**显式过滤条件**（批次 4-A · D2 段②）。
 *
 * ## 为什么从 `query: Partial<Entity>` 挪到这里
 *
 * 旧形态把「后端实体的形状」抬进了前后端共享契约，算子则按 `typeof value` 猜 ——
 * PG 有列类型，猜错的组合会在数据库侧炸（R1 实测 30 格 22 格报错，
 * `reports/batch-1/r1-be-verification.md`）。
 *
 * 现在 `op` 由调用方显式给出，`field` 只是普通字符串：
 *
 * ```text
 * filters: [{ field: 'userName', op: 'like', value: 'adm' },
 *           { field: 'active',   op: 'eq',   value: true },
 *           { field: 'createdAt', op: 'range', value: ['2024-01-01', '2024-12-31'] }]
 * ```
 *
 * ## 本文件的定位
 *
 * 只放**与列类型无关**的纯形状工具（取某字段的过滤项 / 摘出 / 合并）。
 * 「这个 op 对这根列可用吗」「这个值能按列类型解释吗」是**服务端裁决**，
 * 唯一真源在 `@walnut-server/repository` 的 `pg-column-op.ts`
 * （SQL 路径）与各内存链路自己的等值/模糊实现（logger / cache）。
 */
export interface IWalnutAdminListFilter {
  field: string
  op: FilterOp
  value?: unknown
}

export type IWalnutAdminListFilters = IWalnutAdminListFilter[]

/** 取某字段的过滤项（同一字段多条时取**第一条**；无则 undefined） */
export function getFilter(
  filters: IWalnutAdminListFilters | null | undefined,
  field: string,
): IWalnutAdminListFilter | undefined {
  if (!Array.isArray(filters)) {
    return undefined
  }
  return filters.find(item => item !== null && typeof item === 'object' && item.field === field)
}

/**
 * 取某字段的过滤**值**。
 *
 * 只做"有没有 / 是多少"，不做类型收敛 —— 需要严格解释的调用方自己校验
 * （例如 `deleted` 的 content 关键字必须是字符串）。
 */
export function getFilterValue(
  filters: IWalnutAdminListFilters | null | undefined,
  field: string,
): unknown {
  return getFilter(filters, field)?.value
}

/** 去掉若干字段的过滤项（其余原样保留）；结果为空时返回 `undefined`（wire 上不出现空数组） */
export function omitFilters(
  filters: IWalnutAdminListFilters | null | undefined,
  fields: readonly string[],
): IWalnutAdminListFilters | undefined {
  if (!Array.isArray(filters)) {
    return undefined
  }
  const omit = new Set(fields)
  const rest = filters.filter(item => item !== null && typeof item === 'object' && !omit.has(item.field))
  return rest.length > 0 ? rest : undefined
}

/** 只保留若干字段的过滤项；结果为空时返回 `undefined` */
export function pickFilters(
  filters: IWalnutAdminListFilters | null | undefined,
  fields: readonly string[],
): IWalnutAdminListFilters | undefined {
  if (!Array.isArray(filters)) {
    return undefined
  }
  const keep = new Set(fields)
  const picked = filters.filter(item => item !== null && typeof item === 'object' && keep.has(item.field))
  return picked.length > 0 ? picked : undefined
}
