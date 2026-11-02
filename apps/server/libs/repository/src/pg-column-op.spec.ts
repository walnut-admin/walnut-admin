import type { EntityMetadata } from 'typeorm'
import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyPgColumn,
  createPgColumnKindResolver,
  defaultPgListSort,
  describePgRawShape,
  escapeLikePattern,
  isPgListOpAllowed,
  isPgSortableColumnKind,
  normalizeSortOrder,
  resetDroppedPgListConditionCounters,
  resolvePgListCondition,
  warnDroppedPgListCondition,
} from './pg-column-op'

/**
 * 列类型 × 入参形态矩阵 —— 固化 R1 实测（`reports/batch-1/r1-be-verification.md` §1.2）。
 *
 * 断言的不是"某格产出什么算子"，而是**不变式**：
 * 1. 要么返回与列类型兼容的条件（`isPgListOpAllowed` 为 true）；
 * 2. 要么返回 undefined（丢弃）；
 * 3. **永不抛**。
 *
 * R1 的原始故障是第 22 格全部产生类型不匹配的 SQL（42883 / 22P02 / 22007 / 22008）。
 */

type ColumnKind = Parameters<typeof resolvePgListCondition>[0]

interface IRow {
  kind: ColumnKind
  /** R1 矩阵里的列 */
  column: string
  /** 入参形态 */
  form: string
  raw: unknown
  /** 期望：能解释出条件（true）还是丢弃（false） */
  expectCondition: boolean
  expectedOp?: 'ilike' | 'eq' | 'in' | 'range'
}

const DATE_RANGE = ['2024-01-01', '2024-12-31']
const UUID = '5fbd10a4-3039-4c14-b8ef-8aa012345678'

const rows: IRow[] = [
  // ---- text（sys_device.device_name / sys_user.user_name）----
  { kind: 'text', column: 'deviceName', form: '普通字符串', raw: 'iPhone', expectCondition: true, expectedOp: 'ilike' },
  { kind: 'text', column: 'deviceName', form: 'uuid 串', raw: UUID, expectCondition: true, expectedOp: 'ilike' },
  { kind: 'text', column: 'deviceName', form: '数字', raw: 123, expectCondition: true, expectedOp: 'eq' },
  { kind: 'text', column: 'deviceName', form: '布尔', raw: true, expectCondition: true, expectedOp: 'eq' },
  { kind: 'text', column: 'deviceName', form: '日期数组', raw: DATE_RANGE, expectCondition: true, expectedOp: 'in' },
  { kind: 'text', column: 'deviceName', form: '数字数组', raw: [1, 2], expectCondition: true, expectedOp: 'in' },

  // ---- uuid（sys_device.id）----
  { kind: 'uuid', column: 'id', form: '普通字符串', raw: 'abc', expectCondition: false },
  { kind: 'uuid', column: 'id', form: 'uuid 串', raw: UUID, expectCondition: true, expectedOp: 'eq' },
  { kind: 'uuid', column: 'id', form: '数字', raw: 123, expectCondition: false },
  { kind: 'uuid', column: 'id', form: '布尔', raw: true, expectCondition: false },
  { kind: 'uuid', column: 'id', form: '日期数组', raw: DATE_RANGE, expectCondition: false },
  { kind: 'uuid', column: 'id', form: '数字数组', raw: [1, 2], expectCondition: false },

  // ---- datetime（sys_device.created_at）----
  { kind: 'datetime', column: 'createdAt', form: '普通字符串', raw: '2024-01-01', expectCondition: true, expectedOp: 'eq' },
  { kind: 'datetime', column: 'createdAt', form: 'uuid 串', raw: UUID, expectCondition: false },
  { kind: 'datetime', column: 'createdAt', form: '数字', raw: 1700000000000, expectCondition: false },
  { kind: 'datetime', column: 'createdAt', form: '布尔', raw: true, expectCondition: false },
  { kind: 'datetime', column: 'createdAt', form: '日期数组', raw: DATE_RANGE, expectCondition: true, expectedOp: 'range' },
  // R1 坑 3：`new Date(1)` 合法，旧实现把 [1,2] 判成 1970 区间 → 22008/22P02。现在必须丢弃。
  { kind: 'datetime', column: 'createdAt', form: '数字数组', raw: [1, 2], expectCondition: false },

  // ---- boolean（sys_device.active）----
  { kind: 'boolean', column: 'active', form: '普通字符串', raw: 'abc', expectCondition: false },
  { kind: 'boolean', column: 'active', form: 'uuid 串', raw: UUID, expectCondition: false },
  { kind: 'boolean', column: 'active', form: '数字', raw: 1, expectCondition: false },
  { kind: 'boolean', column: 'active', form: '布尔', raw: true, expectCondition: true, expectedOp: 'eq' },
  { kind: 'boolean', column: 'active', form: '日期数组', raw: DATE_RANGE, expectCondition: false },
  { kind: 'boolean', column: 'active', form: '数字数组', raw: [1, 2], expectCondition: false },

  // ---- number（sys_device.risk_score smallint）----
  { kind: 'number', column: 'riskScore', form: '普通字符串', raw: 'abc', expectCondition: false },
  { kind: 'number', column: 'riskScore', form: 'uuid 串', raw: UUID, expectCondition: false },
  { kind: 'number', column: 'riskScore', form: '数字', raw: 50, expectCondition: true, expectedOp: 'eq' },
  { kind: 'number', column: 'riskScore', form: '布尔', raw: true, expectCondition: false },
  { kind: 'number', column: 'riskScore', form: '日期数组', raw: DATE_RANGE, expectCondition: false },
  { kind: 'number', column: 'riskScore', form: '数字数组', raw: [1, 2], expectCondition: true, expectedOp: 'in' },

  // ---- json（sys_device.device_info）----
  { kind: 'json', column: 'deviceInfo', form: '普通字符串', raw: 'abc', expectCondition: false },
  { kind: 'json', column: 'deviceInfo', form: 'uuid 串', raw: UUID, expectCondition: false },
  { kind: 'json', column: 'deviceInfo', form: '数字', raw: 123, expectCondition: true, expectedOp: 'eq' },
  { kind: 'json', column: 'deviceInfo', form: '布尔', raw: true, expectCondition: true, expectedOp: 'eq' },
  { kind: 'json', column: 'deviceInfo', form: '日期数组', raw: DATE_RANGE, expectCondition: false },
  { kind: 'json', column: 'deviceInfo', form: '数字数组', raw: [1, 2], expectCondition: false },
  { kind: 'json', column: 'deviceInfo', form: '对象', raw: { os: 'iOS' }, expectCondition: true, expectedOp: 'eq' },

  // ---- array（sys_device.ip_history text[]）----
  { kind: 'array', column: 'ipHistory', form: '普通字符串', raw: '1.2.3.4', expectCondition: false },
  { kind: 'array', column: 'ipHistory', form: '数字数组', raw: [1, 2], expectCondition: false },
]

describe('pg-column-op · 6 列类型 × 5 入参形态矩阵（R1 实测固化）', () => {
  it.each(rows)('$kind / $form → $expectedOp?', ({ kind, raw, expectCondition, expectedOp }) => {
    const condition = resolvePgListCondition(kind, raw)

    if (!expectCondition) {
      expect(condition).toBeUndefined()
      return
    }

    expect(condition).toBeDefined()
    expect(condition!.op).toBe(expectedOp)
    // 不变式：产出的算子必须与列类型兼容（否则 SQL 层会拒绝）
    expect(isPgListOpAllowed(condition!.op, kind)).toBe(true)
  })

  it('不变式：任意 kind × 任意值都不抛，且返回的条件恒与列类型兼容', () => {
    const kinds: ColumnKind[] = ['text', 'uuid', 'datetime', 'boolean', 'number', 'json', 'array', undefined]
    const values: unknown[] = [
      'abc',
      '',
      UUID,
      '2024-01-01',
      'true',
      '50',
      0,
      1,
      -1,
      1e9,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      false,
      null,
      undefined,
      [],
      [1, 2],
      DATE_RANGE,
      [UUID, UUID],
      {},
      { a: 1 },
      [null, null],
      [{}, {}],
    ]

    for (const kind of kinds) {
      for (const raw of values) {
        expect(() => resolvePgListCondition(kind, raw)).not.toThrow()
        const condition = resolvePgListCondition(kind, raw)
        if (condition !== undefined) {
          expect(isPgListOpAllowed(condition.op, kind)).toBe(true)
        }
      }
    }
  })

  it('datetime 只认 Date / 可解析字符串 —— 数字必须拒（R1 坑 3）', () => {
    expect(resolvePgListCondition('datetime', [1, 2])).toBeUndefined()
    expect(resolvePgListCondition('datetime', [1700000000000, 1700000000001])).toBeUndefined()
    expect(resolvePgListCondition('datetime', [new Date('2024-01-01'), new Date('2024-02-01')])?.op).toBe('range')
  })

  it('text 的 ilike 只对字符串生成；数字/布尔走等值', () => {
    expect(resolvePgListCondition('text', 'x')).toEqual({ op: 'ilike', value: 'x', raw: 'x' })
    expect(resolvePgListCondition('text', 1)).toEqual({ op: 'eq', value: 1, raw: 1 })
    expect(resolvePgListCondition('text', true)).toEqual({ op: 'eq', value: true, raw: true })
  })
})

describe('pg-column-op · 列类型分类', () => {
  it.each([
    ['text', 'text'],
    ['varchar', 'text'],
    ['character varying', 'text'],
    ['uuid', 'uuid'],
    ['timestamptz', 'datetime'],
    ['timestamp with time zone', 'datetime'],
    ['date', 'datetime'],
    ['boolean', 'boolean'],
    ['smallint', 'number'],
    ['integer', 'number'],
    ['bigint', 'number'],
    ['double precision', 'number'],
    ['jsonb', 'json'],
    ['json', 'json'],
  ])('%s → %s', (columnType, kind) => {
    expect(classifyPgColumn(columnType)).toBe(kind)
  })

  it('数组列单列一类；未知类型 undefined', () => {
    expect(classifyPgColumn('text', true)).toBe('array')
    expect(classifyPgColumn('geography')).toBeUndefined()
  })

  it('createPgColumnKindResolver 按 propertyName 解析，未知属性 undefined', () => {
    const metadata = {
      columns: [
        { propertyName: 'id', type: 'uuid', isArray: false },
        { propertyName: 'userName', type: 'text', isArray: false },
      ],
      primaryColumns: [{ propertyName: 'id' }],
    } as unknown as EntityMetadata

    const resolve = createPgColumnKindResolver(metadata)

    expect(resolve('id')).toBe('uuid')
    expect(resolve('userName')).toBe('text')
    expect(resolve('nope')).toBeUndefined()
    expect(createPgColumnKindResolver(undefined)('id')).toBeUndefined()
  })
})

describe('pg-column-op · 排序方向归一', () => {
  it.each([
    ['ascend', 'ASC'],
    ['asc', 'ASC'],
    ['ASC', 'ASC'],
    ['Asc', 'ASC'],
    ['descend', 'DESC'],
    ['desc', 'DESC'],
    ['DESC', 'DESC'],
    [false, false],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSortOrder(input)).toBe(expected)
  })

  it('非法值 → undefined（调用方据此丢弃该排序项）', () => {
    expect(normalizeSortOrder('sideways')).toBeUndefined()
    expect(normalizeSortOrder(undefined)).toBeUndefined()
    expect(normalizeSortOrder(1)).toBeUndefined()
  })
})

describe('pg-column-op · 缺省排序与可排序列', () => {
  const mk = (props: string[], pks: string[] = []) => ({
    columns: props.map(propertyName => ({ propertyName, type: 'text', isArray: false })),
    primaryColumns: pks.map(propertyName => ({ propertyName })),
  }) as unknown as EntityMetadata

  it('createdAt 优先；其次 deletedAt；最后主键', () => {
    expect(defaultPgListSort(mk(['createdAt', 'deletedAt', 'id'], ['id']))).toEqual({ createdAt: 'DESC' })
    expect(defaultPgListSort(mk(['deletedAt', 'id'], ['id']))).toEqual({ deletedAt: 'DESC' })
    expect(defaultPgListSort(mk(['name', 'id'], ['id']))).toEqual({ id: 'DESC' })
    expect(defaultPgListSort(undefined)).toEqual({})
  })

  it('数组列不参与排序', () => {
    expect(isPgSortableColumnKind('text')).toBe(true)
    expect(isPgSortableColumnKind('array')).toBe(false)
    expect(isPgSortableColumnKind(undefined)).toBe(false)
  })
})

describe('pg-column-op · ILIKE 字面量转义', () => {
  it('转义 % _ 与反斜杠，不自造通配符', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('c\\d')).toBe('c\\\\d')
    expect(escapeLikePattern('plain')).toBe('plain')
  })
})

describe('pg-column-op · 丢弃留痕（R3 P2-5：降噪 + 不含原值）', () => {
  beforeEach(() => {
    resetDroppedPgListConditionCounters()
    vi.restoreAllMocks()
  })

  it('逐条落 debug，且**不打印原值**（只给类型 + 长度）', () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    warnDroppedPgListCondition('id', 'uuid', '13800138000', '值无法按列类型解释')

    expect(debugSpy).toHaveBeenCalledTimes(1)
    const message = String(debugSpy.mock.calls[0][0])
    expect(message).toContain('shape=string(length=11)')
    expect(message).not.toContain('13800138000')
  })

  it('warn 只在每 100 次落 1 条汇总（防客户端刷日志）', () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    for (let i = 1; i <= 99; i++) {
      warnDroppedPgListCondition('id', 'uuid', 'abc', '值无法按列类型解释')
    }
    expect(warnSpy).not.toHaveBeenCalled()

    warnDroppedPgListCondition('id', 'uuid', 'abc', '值无法按列类型解释')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('已达 100 次')

    // 每条丢弃仍有 debug 明细 —— 可观测性保留
    expect(debugSpy).toHaveBeenCalledTimes(100)
  })

  it('不同 property / kind / reason 各自计数', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    for (let i = 0; i < 100; i++) {
      warnDroppedPgListCondition('id', 'uuid', 'abc', '值无法按列类型解释')
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnDroppedPgListCondition('active', 'boolean', 'abc', '值无法按列类型解释')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('describePgRawShape 只描述形状', () => {
    expect(describePgRawShape('abcdef')).toBe('string(length=6)')
    expect(describePgRawShape([1, 2, 3])).toBe('array(length=3)')
    expect(describePgRawShape({ a: 1 })).toBe('object')
    expect(describePgRawShape(42)).toBe('number')
    expect(describePgRawShape(true)).toBe('boolean')
    expect(describePgRawShape(null)).toBe('null')
    expect(describePgRawShape(undefined)).toBe('undefined')
  })
})
