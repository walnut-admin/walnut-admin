import type { EntityMetadata } from 'typeorm'
import { Logger } from '@nestjs/common'
import { isNil } from 'lodash'

/**
 * list 查询的**列类型 → 算子 / 值解释**唯一真源（P0 止血 · 批次 1）。
 *
 * ## 为什么需要它
 *
 * B9 迁移把 Mongo 的 `find(filter)` 直译成 `query: Partial<Entity>`，算子按
 * **JS 值的 typeof** 挑（字符串 → ILIKE、布尔/数值/uuid 串 → 等值、数组 → IN/区间）。
 * Mongo 无 schema，这个推断成立；PG 有列类型，于是「值的类型 ≠ 列的类型」就会在
 * 数据库侧炸。R1 实测（`reports/batch-1/r1-be-verification.md`）：6 列类型 × 5 入参形态
 * 的 30 格里 **22 格**产生 PG 错误 —— 不是一条路径，是全谱：
 *
 * | 路径 | 形态 | PG 码 |
 * |------|------|-------|
 * | A | `ILIKE` 打到非文本列（uuid / boolean / jsonb / timestamptz / 数值） | 42883 |
 * | B | `=` 的参数**输入语法**与该列类型不符（uuid 收 "123"、tstz 收 true） | 22P02 / 22007 / 22008 |
 * | C | 日期区间打到非时间列（`[1,2]` 被 `new Date(1)` 判成区间） | 22P02 |
 *
 * ## 口径（Lead 拍板 Q1）
 *
 * **值无法按列类型解释 → 丢弃该条件 + warn，绝不生成类型不匹配的 SQL。**
 * 不做 400：全局异常过滤器永远回 HTTP 200（`exception.filter.ts:93`），
 * "造 400"只是换个业务码，却要动校验层 —— 本批的唯一目标是让 500 消失。
 * 严格的 400 留给批次 4 的显式 filters 契约。
 *
 * ## 消费方（改这里的语义前先看这四处）
 *
 * 1. `pg-list.builder.ts` 的 `buildPgListQueryOptions` / `applyPgListQuery`（DB 列表主线）；
 * 2. `system/src/locale/repo/locale.repo.service.ts`（手写 CTE，自己拼 WHERE）；
 * 3. `system/src/deleted/deleted.basic.repository.ts`（jsonb `::text` 关键字旁路 + 主线）；
 * 4. `libs/list` 的 sort 白名单（只消费 `normalizeSortOrder`）。
 * 分页正规化同源但**不在本文件**：它被 tech-base 的 `libs/cache` 复用，必须落在更低的
 * `@walnut-server/utils/list-page`（见该文件头的分层理由）。
 */

/** 列类型的语义分类（只保留"能决定算子"的粒度） */
export type WalnutPgColumnKind
  = | 'text'
    | 'uuid'
    | 'datetime'
    | 'boolean'
    | 'number'
    | 'json'
    | 'array'

/** 归一化后的 match 条件：`raw` 保留原值，供 SQL 层二次裁决（见 applyPgListQuery） */
export interface IWalnutPgListCondition {
  op: 'ilike' | 'eq' | 'in' | 'range'
  value: unknown
  /** 客户端原始值（未经 typeof 推断）。SQL 层用它按列类型重新裁决，权威以此为准 */
  raw?: unknown
}

const logger = new Logger('PgListQuery')

const TEXT_TYPES = new Set([
  'text',
  'varchar',
  'character varying',
  'char',
  'bpchar',
  'character',
  'citext',
  'name',
  'nvarchar',
])

const UUID_TYPES = new Set(['uuid'])

const DATETIME_TYPES = new Set([
  'timestamptz',
  'timestamp with time zone',
  'timestamp',
  'timestamp without time zone',
  'date',
])

const BOOLEAN_TYPES = new Set(['boolean', 'bool'])

const NUMBER_TYPES = new Set([
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'numeric',
  'decimal',
  'real',
  'float',
  'float4',
  'float8',
  'double precision',
])

const JSON_TYPES = new Set(['json', 'jsonb'])

/** LIKE/ILIKE 通配符字面量转义（`%` `_` 反斜杠）；`locale` 与 `deleted` 共用 */
export const ILIKE_ESCAPE_REGEX = /[\\%_]/g

export function escapeLikePattern(value: string): string {
  return String(value).replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPgUuidString(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/

/**
 * 单列类型 → 语义分类。`array: true` 的原生数组列（`text[]`）单列一类：
 * 本轮不支持过滤（丢弃 + warn），避免 `= ANY` 这类未验证语义上线。
 */
export function classifyPgColumn(columnType: string, isArray: boolean = false): WalnutPgColumnKind | undefined {
  if (isArray) {
    return 'array'
  }

  const type = String(columnType).toLowerCase().trim()

  if (TEXT_TYPES.has(type)) {
    return 'text'
  }
  if (UUID_TYPES.has(type)) {
    return 'uuid'
  }
  if (DATETIME_TYPES.has(type)) {
    return 'datetime'
  }
  if (BOOLEAN_TYPES.has(type)) {
    return 'boolean'
  }
  if (NUMBER_TYPES.has(type)) {
    return 'number'
  }
  if (JSON_TYPES.has(type)) {
    return 'json'
  }

  return undefined
}

/** TypeORM 1.x 的包根不再导出 ColumnMetadata —— 从 EntityMetadata 派生，避免深导入 */
type IWalnutPgColumnMetadata = EntityMetadata['columns'][number]

function classifyColumnMetadata(column: IWalnutPgColumnMetadata): WalnutPgColumnKind | undefined {
  return classifyPgColumn(String(column.type), column.isArray === true)
}

/**
 * 从实体元数据构造「属性名 → 列语义」解析器。
 *
 * 解析不到（属性不存在 / 类型未知）一律返回 undefined —— 调用方按"非可过滤列"丢弃，
 * 与 `applyPgListQuery` 既有的 `columns.has()` 白名单同语义。
 */
export function createPgColumnKindResolver(
  metadata: EntityMetadata | undefined,
): (property: string) => WalnutPgColumnKind | undefined {
  if (metadata === undefined) {
    return () => undefined
  }

  const kinds = new Map<string, WalnutPgColumnKind | undefined>()
  for (const column of metadata.columns) {
    kinds.set(column.propertyName, classifyColumnMetadata(column))
  }

  return (property: string) => kinds.get(property)
}

/** 该列能否参与排序（原生数组列在 PG 里可排序但没有业务意义，排除） */
export function isPgSortableColumnKind(kind: WalnutPgColumnKind | undefined): boolean {
  return kind !== undefined && kind !== 'array'
}

/**
 * 缺省排序：优先 `createdAt`（历史口径），其次 `deletedAt`（回收站没有 createdAt），
 * 最后退到主键 —— 保证**任何**实体都拿到确定性排序，否则 `LIMIT/OFFSET` 会重复/丢行。
 *
 * ## 因本函数而**改变**可见顺序的端点（批次 1 · 已登记，改前先读）
 *
 * 旧实现把默认排序硬编码成 `{ createdAt: 'DESC' }`，再由 SQL 层的列白名单过滤 ——
 * 实体**没有** `createdAt` 时一个 ORDER BY 都不生成（顺序由 PG 物理顺序决定，翻页可能重复/丢行）。
 * 现在这两条端点会拿到确定性排序：
 *
 * | 端点 | 实体 | 旧 | 新 |
 * |------|------|----|----|
 * | `POST /system/deleted/list` | `SysDeletedEntity`（无 createdAt，只有 deletedAt） | 无 ORDER BY | `deleted_at DESC` |
 * | `POST /app/monitor/user/list` | `AppMonitorUserEntity`（无 createdAt，只有 firstVisitAt/lastActiveAt） | 无 ORDER BY | `id DESC`（uuid，稳定但业务无意义） |
 *
 * 其余 15 个 DB list 端点都有 `createdAt`，排序不变（`created_at DESC`）。
 * R3 P2-1 指出上一版报告只登记了 deleted —— 这里补齐第二处。
 * 若 `/app/monitor/user/list` 需要"业务上有意义"的默认序，应显式给
 * `firstVisitAt DESC`（需产品确认，属批次 4 口径）。
 *
 * 另：`sys_deleted.deleted_at` 可空，PG 的 `DESC` 默认 `NULLS FIRST` —— 若出现历史
 * NULL 行会被排到最前（R3 P3 提示，本轮不改）。
 */
export function defaultPgListSort(metadata: EntityMetadata | undefined): Record<string, 'ASC' | 'DESC'> {
  if (metadata !== undefined) {
    const names = new Set(metadata.columns.map(c => c.propertyName))

    if (names.has('createdAt')) {
      return { createdAt: 'DESC' }
    }
    if (names.has('deletedAt')) {
      return { deletedAt: 'DESC' }
    }

    const firstPrimary = metadata.primaryColumns[0]
    if (firstPrimary !== undefined) {
      return { [firstPrimary.propertyName]: 'DESC' }
    }
  }

  return {}
}

/**
 * 排序方向的宽容归一化：`ascend`/`ASC`/`asc` 都收（R1 实测 `"ASC"` 曾被静默当 DESC），
 * `false` 表示"该列不参与排序"（contract 的 `SortOrder` 允许，见 `pagination.ts:8`）。
 */
export function normalizeSortOrder(order: unknown): 'ASC' | 'DESC' | false | undefined {
  if (order === false) {
    return false
  }
  if (typeof order !== 'string') {
    return undefined
  }

  switch (order.toLowerCase()) {
    case 'ascend':
    case 'asc':
      return 'ASC'
    case 'descend':
    case 'desc':
      return 'DESC'
    default:
      return undefined
  }
}

/** 日期区间端点：只认 `Date` 与可解析**字符串** —— 数值拒收（`new Date(1)` 合法会让 `[1,2]` 变成 1970 区间） */
function toRangeDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }
  return undefined
}

function toNumberList(values: readonly unknown[]): number[] | undefined {
  const out: number[] = []
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push(value)
      continue
    }
    if (typeof value === 'string' && NUMERIC_RE.test(value.trim())) {
      out.push(Number(value))
      continue
    }
    return undefined
  }
  return out
}

function isPrimitive(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * 值 + 列语义 → 条件。返回 `undefined` = **丢弃**（调用方记 warn）。
 *
 * 这是本批的核心：算子由**列类型**决定，值按列类型的**输入语法**解释，
 * 解释不了就丢弃 —— 不把类型校验外包给 PG 的文本解析器。
 */
export function resolvePgListCondition(
  kind: WalnutPgColumnKind | undefined,
  raw: unknown,
): IWalnutPgListCondition | undefined {
  if (kind === undefined || isNil(raw)) {
    return undefined
  }

  switch (kind) {
    case 'text': {
      if (typeof raw === 'string') {
        return { op: 'ilike', value: raw, raw }
      }
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        // text = <number|boolean>：node-postgres 以 unknown 文本下发，PG 侧按列类型解析，安全
        return { op: 'eq', value: raw, raw }
      }
      if (Array.isArray(raw) && raw.length > 0 && raw.every(isPrimitive)) {
        return { op: 'in', value: raw, raw }
      }
      return undefined
    }

    case 'uuid': {
      if (isPgUuidString(raw)) {
        return { op: 'eq', value: raw.toLowerCase(), raw }
      }
      if (Array.isArray(raw) && raw.length > 0 && raw.every(isPgUuidString)) {
        return { op: 'in', value: raw.map(v => v.toLowerCase()), raw }
      }
      return undefined
    }

    case 'datetime': {
      const single = toRangeDate(raw)
      if (single !== undefined && !Array.isArray(raw)) {
        return { op: 'eq', value: single, raw }
      }
      if (Array.isArray(raw) && raw.length === 2) {
        const start = toRangeDate(raw[0])
        const end = toRangeDate(raw[1])
        if (start !== undefined && end !== undefined) {
          return { op: 'range', value: [start, end], raw }
        }
      }
      return undefined
    }

    case 'boolean': {
      if (typeof raw === 'boolean') {
        return { op: 'eq', value: raw, raw }
      }
      if (raw === 'true' || raw === 'false') {
        return { op: 'eq', value: raw === 'true', raw }
      }
      return undefined
    }

    case 'number': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { op: 'eq', value: raw, raw } : undefined
      }
      if (typeof raw === 'string' && NUMERIC_RE.test(raw.trim())) {
        return { op: 'eq', value: Number(raw), raw }
      }
      if (Array.isArray(raw) && raw.length > 0) {
        const numbers = toNumberList(raw)
        if (numbers !== undefined) {
          return { op: 'in', value: numbers, raw }
        }
      }
      return undefined
    }

    case 'json': {
      // jsonb 只接受合法 json 字面量：对象 / 数组 / 数值 / 布尔 / null。
      // 普通字符串（"abc"）不是 json 字面量 ⇒ PG 22P02，必须丢弃。
      // 注意数组有歧义（IN 语义 vs jsonb 数组等值），本轮按丢弃处理。
      if (Array.isArray(raw)) {
        return undefined
      }
      if (raw !== null && typeof raw === 'object') {
        return { op: 'eq', value: raw, raw }
      }
      if (typeof raw === 'number' || typeof raw === 'boolean') {
        return { op: 'eq', value: raw, raw }
      }
      return undefined
    }

    case 'array': {
      // text[] 等原生数组列：等值/包含语义未验证，本轮一律丢弃
      return undefined
    }
  }
}

/** 该 (op, 列语义) 组合是否可能生成类型正确的 SQL（SQL 层兜底用） */
export function isPgListOpAllowed(op: IWalnutPgListCondition['op'], kind: WalnutPgColumnKind | undefined): boolean {
  if (kind === undefined) {
    return false
  }

  switch (op) {
    case 'ilike':
      return kind === 'text'
    case 'range':
      return kind === 'datetime'
    case 'eq':
    case 'in':
      return kind !== 'array'
  }
}

/**
 * 丢弃条件时留痕（不抛，不 400）。
 *
 * R3 P2-5 修正了两件事：
 * 1. **级别**：原先每条 `warn` —— 客户端一个请求带 N 个非法过滤值就是 N 条 warn，
 *    `logs/` 可被刷。现在逐条降为 `debug`，只按「property+kind+reason」计数，
 *    每累计 `DROP_SUMMARY_INTERVAL` 次落 **1 条 warn 汇总**（可观测性保留、放大被削）。
 * 2. **不再打印原值**：原先把 `raw` 截 120 字符写进日志，而过滤值可能是手机号/邮箱
 *    等查询词 —— 与本仓「日志脱敏」口径（`maskSensitiveFields`）不一致。
 *    现在只留**类型 + 长度**（`string(11)`），够定位问题、不含内容。
 */
export const DROP_SUMMARY_INTERVAL = 100

const dropCounters = new Map<string, number>()

/** 测试用：清空计数器，避免用例之间互相影响 */
export function resetDroppedPgListConditionCounters(): void {
  dropCounters.clear()
}

/** 值的形状（类型 + 长度），**不含内容** —— 取代原先的 raw 截断 */
export function describePgRawShape(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return 'undefined'
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`
  }
  if (typeof value === 'string') {
    return `string(length=${value.length})`
  }
  if (typeof value === 'object') {
    return 'object'
  }
  return typeof value
}

export function warnDroppedPgListCondition(
  property: string,
  kind: WalnutPgColumnKind | undefined,
  raw: unknown,
  reason: string,
): void {
  const counterKey = `${property}|${kind ?? 'unknown'}|${reason}`
  const count = (dropCounters.get(counterKey) ?? 0) + 1
  dropCounters.set(counterKey, count)

  logger.debug(
    `丢弃 list 过滤条件 property=${property} kind=${kind ?? 'unknown'} `
    + `shape=${describePgRawShape(raw)} reason=${reason} count=${count}`,
  )

  if (count % DROP_SUMMARY_INTERVAL === 0) {
    logger.warn(
      `list 过滤条件丢弃已达 ${count} 次（property=${property} kind=${kind ?? 'unknown'} reason=${reason}）`
      + ' —— 逐条细节见 debug 日志',
    )
  }
}
