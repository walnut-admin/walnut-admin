import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutPgListQueryContext } from './pg-list.builder'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import { applyPgListQuery, buildPgListQueryOptions, buildPgListQueryOptionsFromQb } from './pg-list.builder'

/**
 * builder 的算子/排序/分页行为 —— 用**结构化 fake qb**（零 DB）固化：
 * 1. 值类型与列类型不匹配 ⇒ 丢弃条件，SQL 里不出现该列；
 * 2. 未知 sort field / 非法 order 不得清空默认排序；
 * 3. page 正规化后的 skip/limit 落到 offset/limit；
 * 4. `applyPgListQuery` 是权威裁决点（即便 match 是外部塞进来的也会被重裁决）。
 */

interface IFakeColumn {
  propertyName: string
  type: string
  isArray?: boolean
}

function makeMetadata(columns: IFakeColumn[], pks: string[] = ['id']): EntityMetadata {
  return {
    columns: columns.map(c => ({ ...c, isArray: c.isArray ?? false })),
    primaryColumns: pks.map(propertyName => ({ propertyName })),
  } as unknown as EntityMetadata
}

const METADATA = makeMetadata([
  { propertyName: 'id', type: 'uuid' },
  { propertyName: 'deviceName', type: 'text' },
  { propertyName: 'createdAt', type: 'timestamptz' },
  { propertyName: 'active', type: 'boolean' },
  { propertyName: 'riskScore', type: 'smallint' },
  { propertyName: 'deviceInfo', type: 'jsonb' },
  { propertyName: 'ipHistory', type: 'text', isArray: true },
])

interface IFakeQb {
  where: Array<{ sql: string, params: Record<string, unknown> }>
  orderBys: Record<string, 'ASC' | 'DESC'>
  offsetValue?: number
  limitValue?: number
  qb: IWalnutPgListQueryContext
}

function makeQb(): IFakeQb {
  const where: IFakeQb['where'] = []
  const orderBys: IFakeQb['orderBys'] = {}
  const state: { offsetValue?: number, limitValue?: number } = {}

  const qb: IWalnutPgListQueryContext & Record<string, unknown> = {
    expressionMap: { mainAlias: { metadata: METADATA }, orderBys },
    andWhere(sql: string, params?: Record<string, unknown>) {
      where.push({ sql, params: params ?? {} })
      return qb
    },
    addOrderBy(column: string, direction: 'ASC' | 'DESC') {
      orderBys[column] = direction
      return qb
    },
    offset(value: number) {
      state.offsetValue = value
      return qb
    },
    limit(value: number) {
      state.limitValue = value
      return qb
    },
  }

  return {
    where,
    orderBys,
    get offsetValue() { return state.offsetValue },
    get limitValue() { return state.limitValue },
    qb,
  }
}

function applyTo(fake: IFakeQb, params: IWalnutAdminRequestList<unknown>) {
  const options = buildPgListQueryOptionsFromQb(fake.qb, params as never)
  applyPgListQuery(fake.qb as SelectQueryBuilder<ObjectLiteral>, 'entity', options)
  return options
}

describe('buildPgListQueryOptionsFromQb · 值 → 条件（列类型驱动）', () => {
  it('uuid 列收到非 uuid 字符串 ⇒ 丢弃，不出现在 match / SQL 里', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { id: 'abc' } } as never)

    expect(options.match.id).toBeUndefined()
    expect(fake.where.map(w => w.sql).join(' ')).not.toContain('"id"')
  })

  it('timestamptz 列收到标量日期 ⇒ 等值（不是 ILIKE）', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { createdAt: '2024-01-01' } } as never)

    expect(options.match.createdAt?.op).toBe('eq')
    expect(fake.where[0]?.sql).toContain('entity.createdAt =')
  })

  it('timestamptz + 日期数组 ⇒ range，且两条边界', () => {
    const fake = makeQb()
    applyTo(fake, { query: { createdAt: ['2024-01-01', '2024-12-31'] } } as never)

    expect(fake.where).toHaveLength(2)
    expect(fake.where[0].sql).toContain('>=')
    expect(fake.where[1].sql).toContain('<')
  })

  it('boolean 列收到 "true" 字符串 ⇒ 归一为布尔等值', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { active: 'true' } } as never)

    expect(options.match.active).toEqual({ op: 'eq', value: true, raw: 'true' })
  })

  it('boolean 列收到 "abc" ⇒ 丢弃（旧实现 ILIKE 打 boolean → 42883）', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { active: 'abc' } } as never)

    expect(options.match.active).toBeUndefined()
    expect(fake.where).toHaveLength(0)
  })

  it('smallint 列收到 "abc" ⇒ 丢弃；收到数字数组 ⇒ IN', () => {
    const dropped = makeQb()
    expect(applyTo(dropped, { query: { riskScore: 'abc' } } as never).match.riskScore).toBeUndefined()

    const inCase = makeQb()
    const options = applyTo(inCase, { query: { riskScore: [1, 2] } } as never)
    expect(options.match.riskScore?.op).toBe('in')
    expect(inCase.where[0].sql).toContain('IN (:...')
  })

  it('jsonb 列收到普通字符串 ⇒ 丢弃；收到对象 ⇒ 等值', () => {
    const bad = makeQb()
    expect(applyTo(bad, { query: { deviceInfo: 'abc' } } as never).match.deviceInfo).toBeUndefined()

    const good = makeQb()
    expect(applyTo(good, { query: { deviceInfo: { os: 'iOS' } } } as never).match.deviceInfo?.op).toBe('eq')
  })

  it('text 列收到字符串 ⇒ ILIKE，通配符被字面量转义', () => {
    const fake = makeQb()
    applyTo(fake, { query: { deviceName: '100%' } } as never)

    expect(fake.where[0].sql).toContain('ILIKE')
    expect(fake.where[0].params[Object.keys(fake.where[0].params)[0]]).toBe('%100\\%%')
  })

  it('原生数组列（text[]）⇒ 丢弃', () => {
    const fake = makeQb()
    expect(applyTo(fake, { query: { ipHistory: '1.2.3.4' } } as never).match.ipHistory).toBeUndefined()
  })

  it('非实体列 ⇒ 静默丢弃（不 warn 刷屏）', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { totallyBogus: 'x' } } as never)

    expect(options.match.totallyBogus).toBeUndefined()
    expect(fake.where).toHaveLength(0)
  })

  it('nil 值跳过', () => {
    const fake = makeQb()
    const options = applyTo(fake, { query: { deviceName: null, id: undefined } } as never)

    expect(Object.keys(options.match)).toHaveLength(0)
  })
})

describe('sort · 未知字段不得清空默认排序', () => {
  it('全部 sort field 都不可排序 ⇒ 回落 createdAt DESC', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [{ field: 'notAColumn', order: 'ascend', priority: 1 }] } as never)

    // 默认排序 + D15 主键兜底
    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })

  it('数组列不可排序 ⇒ 同样回落默认', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [{ field: 'ipHistory', order: 'ascend', priority: 1 }] } as never)

    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })

  it('合法 sort 覆盖默认排序', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [{ field: 'deviceName', order: 'ascend', priority: 1 }] } as never)

    // 追加键沿用最后一个排序键的方向
    expect(fake.orderBys).toEqual({ 'entity.deviceName': 'ASC', 'entity.id': 'ASC' })
  })

  it('order: false ⇒ 该列不排序（回落默认，不报错）', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [{ field: 'deviceName', order: false, priority: 1 }] } as never)

    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })

  it('大写方向 / asc 别名都能识别（旧实现把 "ASC" 静默当 DESC）', () => {
    const upper = makeQb()
    applyTo(upper, { sort: [{ field: 'deviceName', order: 'ASC', priority: 1 }] } as never)
    expect(upper.orderBys).toEqual({ 'entity.deviceName': 'ASC', 'entity.id': 'ASC' })

    const alias = makeQb()
    applyTo(alias, { sort: [{ field: 'deviceName', order: 'desc', priority: 1 }] } as never)
    expect(alias.orderBys).toEqual({ 'entity.deviceName': 'DESC', 'entity.id': 'DESC' })
  })

  it('非法方向 ⇒ 丢弃该排序项', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [{ field: 'deviceName', order: 'sideways', priority: 1 }] } as never)

    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })

  it('priority 降序决定先后', () => {
    const fake = makeQb()
    const options = buildPgListQueryOptionsFromQb(fake.qb, {
      sort: [
        { field: 'deviceName', order: 'ascend', priority: 1 },
        { field: 'createdAt', order: 'descend', priority: 9 },
      ],
    } as never)
    // 主键兜底恒在最后（D15）
    expect(Object.keys(options.sort)).toEqual(['createdAt', 'deviceName', 'id'])
  })

  it('空 sort 数组 ⇒ 默认排序', () => {
    const fake = makeQb()
    applyTo(fake, { sort: [] } as never)
    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })
})

describe('page · 正规化落到 offset/limit', () => {
  it.each([
    [undefined, 0, 10],
    [{ page: 2, pageSize: 20 }, 20, 20],
    [{ pageSize: 20 }, 0, 20],
    [{ page: 3 }, 20, 10],
    [{ page: 'abc', pageSize: 10 }, 0, 10],
    [{ page: -1, pageSize: 10 }, 0, 10],
    [{ page: 1, pageSize: -5 }, 0, 10],
    [{ page: 1, pageSize: 0 }, 0, 10],
    [{ page: 1, pageSize: 1e9 }, 0, 9999],
  ])('%j ⇒ offset %i / limit %i', (page, expectedOffset, expectedLimit) => {
    const fake = makeQb()
    applyTo(fake, { page } as never)

    expect(fake.offsetValue).toBe(expectedOffset)
    expect(fake.limitValue).toBe(expectedLimit)
  })

  it('pageAdjusted 只在入参被改写时为 true', () => {
    const normal = makeQb()
    expect(buildPgListQueryOptionsFromQb(normal.qb, { page: { page: 2, pageSize: 20 } }).pageAdjusted).toBe(false)

    const adjusted = makeQb()
    expect(buildPgListQueryOptionsFromQb(adjusted.qb, { page: { page: -1, pageSize: 20 } }).pageAdjusted).toBe(true)
  })
})

describe('applyPgListQuery · 权威裁决（外部塞进来的 match 也要过一遍）', () => {
  it('旧 typeof 路径产出 ilike 打在 uuid 列 ⇒ SQL 层丢弃', () => {
    const fake = makeQb()
    // 故意不给 resolver（走兼容路径），raw 会被带上
    const legacy = buildPgListQueryOptions({ query: { id: 'abc' } }, {}, undefined, METADATA)
    expect(legacy.match.id?.op).toBe('ilike')

    applyPgListQuery(
      fake.qb as SelectQueryBuilder<ObjectLiteral>,
      'entity',
      legacy,
    )

    expect(fake.where).toHaveLength(0)
  })

  it('手写 match 无 raw 时按 op×kind 兼容性裁决', () => {
    const fake = makeQb()
    applyPgListQuery(
      fake.qb as SelectQueryBuilder<ObjectLiteral>,
      'entity',
      {
        match: {
          createdAt: { op: 'ilike', value: 'x' },
          deviceInfo: { op: 'range', value: [new Date(), new Date()] },
          id: { op: 'eq', value: 'not-a-uuid' },
        },
        sort: {},
        skip: 0,
        limit: 10,
        metadata: METADATA,
      },
    )

    // ilike 打 timestamptz / range 打 jsonb ⇒ 都不允许；eq 无 raw 时按 op×kind 放行（值由调用方保证）
    expect(fake.where.map(w => w.sql).join(' ')).not.toContain('ILIKE')
    expect(fake.where.map(w => w.sql).join(' ')).not.toContain('>=')
  })

  it('无任何可排序字段落入时补默认排序（防翻页重复/丢行）', () => {
    const fake = makeQb()
    applyPgListQuery(
      fake.qb as SelectQueryBuilder<ObjectLiteral>,
      'entity',
      { match: {}, sort: { notAColumn: 'ASC' }, skip: 0, limit: 10, metadata: METADATA },
    )

    expect(fake.orderBys).toEqual({ 'entity.createdAt': 'DESC', 'entity.id': 'DESC' })
  })

  it('列名含空格/分号等注入尝试 ⇒ 不生成任何 SQL（被列白名单丢弃）', () => {
    const fake = makeQb()
    applyPgListQuery(
      fake.qb as SelectQueryBuilder<ObjectLiteral>,
      'entity',
      {
        match: { 'id; DROP TABLE sys_user': { op: 'eq', value: 'x' } },
        sort: { 'devicename) OR 1=1--': 'ASC' },
        skip: 0,
        limit: 10,
        metadata: METADATA,
      },
    )

    expect(fake.where).toHaveLength(0)
    // 仍然有兜底排序，但列名来自实体元数据，不含注入串
    expect(Object.keys(fake.orderBys)).toEqual(['entity.createdAt', 'entity.id'])
  })
})

// ---------------------------------------------------------------------------
// 批次 4-A · 显式 filters wire（D2 段②）
// ---------------------------------------------------------------------------

describe('filters · 显式 op × 列类型', () => {
  it('text 列 + like ⇒ ILIKE（通配符仍转义），条件带 filterOp', () => {
    const fake = makeQb()
    const options = applyTo(fake, { filters: [{ field: 'deviceName', op: 'like', value: '100%' }] } as never)

    expect(options.match.deviceName?.op).toBe('ilike')
    expect(options.match.deviceName?.filterOp).toBe('like')
    expect(fake.where[0].sql).toContain('ILIKE')
    expect(fake.where[0].params[Object.keys(fake.where[0].params)[0]]).toBe('%100\\%%')
  })

  it('uuid 列 + eq ⇒ 值小写化后等值', () => {
    const fake = makeQb()
    const options = applyTo(fake, {
      filters: [{ field: 'id', op: 'eq', value: '5FBD10A4-0000-4000-8000-000000000000' }],
    } as never)

    expect(options.match.id).toEqual({
      op: 'eq',
      value: '5fbd10a4-0000-4000-8000-000000000000',
      filterOp: 'eq',
    })
  })

  it('boolean 列 + eq ⇒ 归一为布尔', () => {
    const fake = makeQb()
    const options = applyTo(fake, { filters: [{ field: 'active', op: 'eq', value: 'true' }] } as never)

    expect(options.match.active?.value).toBe(true)
  })

  it('数值列 + in ⇒ IN（不再按值类型猜）', () => {
    const fake = makeQb()
    const options = applyTo(fake, { filters: [{ field: 'riskScore', op: 'in', value: [1, 2] }] } as never)

    expect(options.match.riskScore?.op).toBe('in')
    expect(fake.where[0].sql).toContain('IN (:...')
  })

  it('时间列 + range ⇒ 两条边界', () => {
    const fake = makeQb()
    applyTo(fake, {
      filters: [{ field: 'createdAt', op: 'range', value: ['2024-01-01', '2024-12-31'] }],
    } as never)

    expect(fake.where).toHaveLength(2)
    expect(fake.where[0].sql).toContain('>=')
    expect(fake.where[1].sql).toContain('<')
  })

  it('isNull ⇒ IS NULL / IS NOT NULL（value: false 取反）', () => {
    const nullCase = makeQb()
    applyTo(nullCase, { filters: [{ field: 'createdAt', op: 'isNull' }] } as never)
    expect(nullCase.where[0].sql).toContain('IS NULL')

    const notNullCase = makeQb()
    applyTo(notNullCase, { filters: [{ field: 'createdAt', op: 'isNull', value: false }] } as never)
    expect(notNullCase.where[0].sql).toContain('IS NOT NULL')
  })

  it('jsonb 列 + eq 对象 ⇒ 等值', () => {
    const fake = makeQb()
    const options = applyTo(fake, { filters: [{ field: 'deviceInfo', op: 'eq', value: { os: 'iOS' } }] } as never)

    expect(options.match.deviceInfo?.op).toBe('eq')
  })

  it('非实体列 ⇒ 仍按列白名单丢弃（过滤面含 JOIN 别名键，不 400）', () => {
    const fake = makeQb()
    const options = applyTo(fake, { filters: [{ field: 'totallyBogus', op: 'like', value: 'x' }] } as never)

    expect(options.match.totallyBogus).toBeUndefined()
    expect(fake.where).toHaveLength(0)
  })
})

/** R1 矩阵里会产生 PG 错误的组合 —— 全部必须在进 SQL 前被拒成 40099 */
const REJECTED_FILTERS: Array<[string, Array<{ field: string, op: string, value?: unknown }>]> = [
  ['like 打 uuid 列', [{ field: 'id', op: 'like', value: 'abc' }]],
  ['like 打 boolean 列', [{ field: 'active', op: 'like', value: 'abc' }]],
  ['like 打 jsonb 列', [{ field: 'deviceInfo', op: 'like', value: 'abc' }]],
  ['like 打 timestamptz 列', [{ field: 'createdAt', op: 'like', value: '2024-01-01' }]],
  ['like 打数值列', [{ field: 'riskScore', op: 'like', value: 'abc' }]],
  ['like 的 value 不是字符串', [{ field: 'deviceName', op: 'like', value: 123 }]],
  ['uuid 列收到非 uuid 串', [{ field: 'id', op: 'eq', value: '123' }]],
  ['uuid 列 + range', [{ field: 'id', op: 'range', value: ['2024-01-01', '2024-12-31'] }]],
  ['boolean 列收到 "abc"', [{ field: 'active', op: 'eq', value: 'abc' }]],
  ['jsonb 列收到普通字符串', [{ field: 'deviceInfo', op: 'eq', value: 'abc' }]],
  ['timestamptz 列收到数值', [{ field: 'createdAt', op: 'eq', value: 1700000000000 }]],
  ['timestamptz 列收到布尔', [{ field: 'createdAt', op: 'eq', value: true }]],
  ['smallint 列收到 "abc"', [{ field: 'riskScore', op: 'eq', value: 'abc' }]],
  ['range 打 boolean 列', [{ field: 'active', op: 'range', value: ['2024-01-01', '2024-12-31'] }]],
  ['range 打 jsonb 列', [{ field: 'deviceInfo', op: 'range', value: ['2024-01-01', '2024-12-31'] }]],
  ['range 打数值列', [{ field: 'riskScore', op: 'range', value: ['2024-01-01', '2024-12-31'] }]],
  ['range 端点是非时间数值', [{ field: 'createdAt', op: 'range', value: [1, 2] }]],
  ['range 端点长度不足', [{ field: 'createdAt', op: 'range', value: ['2024-01-01'] }]],
  ['in 的 value 不是数组', [{ field: 'riskScore', op: 'in', value: 1 }]],
  ['in 的 value 是空数组', [{ field: 'riskScore', op: 'in', value: [] }]],
  ['in 的取值无法按列解释', [{ field: 'riskScore', op: 'in', value: ['abc'] }]],
  ['原生数组列不支持过滤', [{ field: 'ipHistory', op: 'eq', value: '1.2.3.4' }]],
  ['eq 缺 value', [{ field: 'deviceName', op: 'eq' }]],
  ['未知算子', [{ field: 'deviceName', op: 'gt', value: 'x' }]],
]

describe('filters · 非法 op/值 ⇒ 40099（永不 50000）', () => {
  it.each(REJECTED_FILTERS)('%s', (_name, filters) => {
    const fake = makeQb()

    expect(() => applyTo(fake, { filters } as never)).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR }) }),
    )
    // 一条 SQL 都不该发出去
    expect(fake.where).toHaveLength(0)
  })

  it('applyPgListQuery 是权威裁决点：外部塞进来的显式条件也会被重裁决', () => {
    const fake = makeQb()

    expect(() =>
      applyPgListQuery(
        fake.qb as SelectQueryBuilder<ObjectLiteral>,
        'entity',
        {
          match: { id: { op: 'ilike', value: 'abc', filterOp: 'like' } },
          sort: {},
          skip: 0,
          limit: 10,
          metadata: METADATA,
        },
      ),
    ).toThrowError(expect.objectContaining({ response: expect.objectContaining({ errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR }) }))
    expect(fake.where).toHaveLength(0)
  })
})
