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
  op: 'ilike' | 'eq' | 'in' | 'range' | 'isNull'
  value: unknown
  /** 客户端原始值（未经 typeof 推断）。SQL 层用它按列类型重新裁决，权威以此为准 */
  raw?: unknown
  /**
   * 显式过滤（批次 4-A）的来源算子。存在即表示"这是 `filters[].op` 给的算子"，
   * SQL 层**不再按 raw 猜**，而是按 (filterOp, 列类型) 重新裁决；裁决不过 = 40099。
   */
  filterOp?: WalnutPgFilterOp
}

/**
 * `filters[].op` 的取值（与 `@walnut/contract` 的 `FilterOp` 同集）。
 *
 * 注意与内部 `op` 的差别：wire 上叫 `like`（不暴露 PG 的 ILIKE 方言），
 * 内部条件仍写 `ilike`（SQL 层直接拼字面量）。
 */
export type WalnutPgFilterOp = 'eq' | 'like' | 'in' | 'range' | 'isNull'

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
    // IS NULL / IS NOT NULL 对任何列类型都合法（含原生数组列）
    case 'isNull':
      return true
    case 'eq':
    case 'in':
      return kind !== 'array'
  }
}

// ---------------------------------------------------------------------------
// 显式 filters（批次 4-A）—— 算子由调用方给，值按列类型解释，解释不了就 **拒绝**
// ---------------------------------------------------------------------------

/** wire 算子类型守卫：DTO 已按枚举校验过，直接调用方（测试/库外）没有，必须自己拦 */
export function isWalnutPgFilterOp(op: unknown): op is WalnutPgFilterOp {
  return op === 'eq' || op === 'like' || op === 'in' || op === 'range' || op === 'isNull'
}

/** wire 算子 -> 内部条件算子（两者词汇不同：wire 的 like 在 SQL 层是 ILIKE） */
export function toPgListConditionOp(op: WalnutPgFilterOp): IWalnutPgListCondition['op'] {
  return op === 'like' ? 'ilike' : op
}

/** 显式过滤的裁决结果：要么给出条件，要么给出拒绝理由（调用方转 40099） */
export type WalnutPgFilterResolution
  = | { ok: true, condition: IWalnutPgListCondition }
    | { ok: false, reason: string }

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true' || value === 'false') {
    return value === 'true'
  }
  return undefined
}

function toNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string' && NUMERIC_RE.test(value.trim())) {
    return Number(value)
  }
  return undefined
}

/** 标量按列类型的输入语法解释；解释不了 -> undefined（调用方 40099） */
function coerceScalarForKind(kind: WalnutPgColumnKind, value: unknown): unknown {
  switch (kind) {
    case 'text':
      return isPrimitive(value) ? value : undefined
    case 'uuid':
      return isPgUuidString(value) ? value.toLowerCase() : undefined
    case 'datetime':
      return toRangeDate(value)
    case 'boolean':
      return toBooleanValue(value)
    case 'number':
      return toNumericValue(value)
    case 'json':
      // jsonb 只接受合法 json 字面量；普通字符串不是字面量 => PG 22P02
      if (Array.isArray(value)) {
        return undefined
      }
      if (value !== null && typeof value === 'object') {
        return value
      }
      return typeof value === 'number' || typeof value === 'boolean' ? value : undefined
    case 'array':
      return undefined
  }
}

/**
 * 数组取值按列类型逐个解释。
 *
 * json 列刻意不支持 in 算子（jsonb 数组到底是「值」还是「候选集」有歧义，与批次 1 同口径）。
 */
function coerceListForKind(kind: WalnutPgColumnKind, values: readonly unknown[]): unknown[] | undefined {
  if (kind === 'json' || kind === 'array') {
    return undefined
  }

  const out: unknown[] = []
  for (const value of values) {
    const coerced = coerceScalarForKind(kind, value)
    if (coerced === undefined) {
      return undefined
    }
    out.push(coerced)
  }
  return out
}

/**
 * **显式 op x 列类型 -> 条件**（批次 4-A 的唯一裁决点）。
 *
 * 与 `resolvePgListCondition` 的分工：
 * - `resolvePgListCondition`：**旧 wire**（`query: Partial<Entity>`）用，算子按值的
 *   typeof 猜，猜不出来就丢弃 + warn（兼容兜底，保留给 query 兼容路径与库外调用方）；
 * - `resolvePgFilterCondition`（本函数）：**新 wire**（`filters: [{ field, op, value }]`）用，
 *   算子由调用方给，这里只裁决「这个 op 对这根列可用吗 / 这个值能按这根列解释吗」，
 *   裁决不过就**明确拒绝**（`ok: false`，调用方转 40099），不再降级成丢弃。
 *
 * 覆盖 R1 矩阵的全部 22 个报错格（`reports/batch-1/r1-be-verification.md` 1.2 节）：
 * like 打非文本列 / uuid 列收非 uuid 串 / 布尔列收 "abc" / 时间列收数值 /
 * range 打非时间列 / 数值列收日期区间 —— 全部在进 SQL 之前被拒。
 *
 * **唯一一处例外（批次 9 · C6）**：`like` 打**布尔列**且值可解释成布尔（`true` / `false` /
 * `"true"` / `"false"`）时裁决成 `eq` —— 那颗字典布尔值（`sys_shared_status`）就这样变成
 * 真布尔，表头筛选才真的可用。值解释不了布尔时仍按「like 打非文本列」拒绝，语义没松。
 */
export function resolvePgFilterCondition(
  kind: WalnutPgColumnKind | undefined,
  op: WalnutPgFilterOp,
  value: unknown,
): WalnutPgFilterResolution {
  if (kind === undefined) {
    // 未知列由调用方先按「非实体列」丢弃（filters 面本来就含 JOIN 别名键），走不到这里
    return { ok: false, reason: '列类型未知，无法裁决算子' }
  }

  if (op === 'isNull') {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return { ok: false, reason: 'isNull 的 value 只能是缺省 / null / boolean' }
    }
    // value 为 false => IS NOT NULL，其余 => IS NULL
    return { ok: true, condition: { op: 'isNull', value: value === false, filterOp: op } }
  }

  if (kind === 'array') {
    return { ok: false, reason: '原生数组列不支持过滤' }
  }

  if (op === 'like') {
    // 布尔列 + like：**字典布尔值 → 真布尔**的唯一转换点（批次 9 · C6）。
    //
    // 场景：`status` 这类布尔列在表头挂的是字典 `sys_shared_status`，字典值在 seed 里是
    // 字符串 "true"/"false"，而前端只有「值形态」没有「列类型」（`list-filters.ts` 的口径：
    // 字符串 ⇒ like），于是它必然发出 `{ op: 'like', value: 'true' }`。布尔列没有子串语义，
    // 这里把它裁决成**等值**；解释不了布尔（"abc" / 1 / 数组）仍然 40099。
    //
    // 换到前端转是不行的：那需要在前端维护「字段 → 列类型」的镜像（第二个真源），
    // 而列类型的权威就在本函数手里（EntityMetadata）。所以转换只落这一处。
    if (kind === 'boolean') {
      const bool = toBooleanValue(value)
      if (bool !== undefined) {
        return { ok: true, condition: { op: 'eq', value: bool, filterOp: op } }
      }
      return { ok: false, reason: 'like 打布尔列时 value 只能是布尔字面量（true / false / "true" / "false"）' }
    }
    if (kind !== 'text') {
      return { ok: false, reason: `like 只对文本列可用（该列是 ${kind}）` }
    }
    if (typeof value !== 'string') {
      return { ok: false, reason: 'like 的 value 必须是字符串' }
    }
    return { ok: true, condition: { op: 'ilike', value, filterOp: op } }
  }

  if (op === 'range') {
    if (kind !== 'datetime') {
      return { ok: false, reason: `range 只对时间列可用（该列是 ${kind}）` }
    }
    if (!Array.isArray(value) || value.length !== 2) {
      return { ok: false, reason: 'range 的 value 必须是长度 2 的数组' }
    }
    const start = toRangeDate(value[0])
    const end = toRangeDate(value[1])
    if (start === undefined || end === undefined) {
      return { ok: false, reason: 'range 的端点必须是 Date 或可解析的时间字符串' }
    }
    return { ok: true, condition: { op: 'range', value: [start, end], filterOp: op } }
  }

  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, reason: 'in 的 value 必须是非空数组' }
    }
    const values = coerceListForKind(kind, value)
    if (values === undefined) {
      return { ok: false, reason: `in 的取值无法按 ${kind} 列解释` }
    }
    return { ok: true, condition: { op: 'in', value: values, filterOp: op } }
  }

  const single = coerceScalarForKind(kind, value)
  if (single === undefined) {
    return { ok: false, reason: `eq 的取值无法按 ${kind} 列解释` }
  }
  return { ok: true, condition: { op: 'eq', value: single, filterOp: op } }
}

/**
 * 默认排序的**稳定性兜底**（D15）：把主键追加成最后一个排序键。
 *
 * ## 为什么必须加
 *
 * createdAt 只到毫秒（timestamptz 微秒，但业务写入常同毫秒），同毫秒的行在
 * `ORDER BY created_at DESC` 下**顺序不确定** —— 配合 LIMIT/OFFSET 就是翻页漏行/重行
 * （第 1 页尾与第 2 页头可能重叠，也可能有行永远看不到）。
 * 追加主键后排序是全序（PK 唯一），同一查询的任意两页严格不交叠。
 *
 * ## 方向
 *
 * 追加键沿用**最后一个已有排序键的方向**（createdAt DESC => id DESC），
 * 这样「同毫秒内继续按同一方向细分」符合直觉；没有任何排序键时用 DESC。
 *
 * 幂等：主键已经在排序里就原样返回（applyPgListQuery 与 buildPgListQueryOptions
 * 两处都会调，不会重复追加）。
 */
export function withPgListTiebreaker(
  sort: Record<string, 'ASC' | 'DESC'>,
  metadata: EntityMetadata | undefined,
): Record<string, 'ASC' | 'DESC'> {
  const primary = metadata?.primaryColumns?.[0]?.propertyName
  if (primary === undefined || sort[primary] !== undefined) {
    return sort
  }

  const directions = Object.values(sort)
  const direction = directions.length > 0 ? directions[directions.length - 1] : 'DESC'

  return { ...sort, [primary]: direction }
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
