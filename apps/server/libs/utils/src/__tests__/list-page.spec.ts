import { describe, expect, it } from 'vitest'
import {
  normalizeListPage,
  WALNUT_LIST_PAGE_DEFAULT,
  WALNUT_LIST_PAGE_SIZE_DEFAULT,
  WALNUT_LIST_PAGE_SIZE_MAX,
} from '../list-page'

/**
 * 分页正规化 —— 固化 R1 实测的四个故障形态：page 非数字（TypeORM 抛 offset 非数字）、
 * page < 1（2201X OFFSET must not be negative）、pageSize < 1（2201W / LIMIT 0 静默空页）、
 * pageSize 超上限（1e9 真发给数据库）。四种都先崩在 PG 或静默返回错数据。
 */
describe('normalizeListPage', () => {
  it('缺省：page=1 / pageSize=10，且不算 adjusted', () => {
    const r = normalizeListPage(undefined)
    expect(r).toMatchObject({ page: WALNUT_LIST_PAGE_DEFAULT, pageSize: WALNUT_LIST_PAGE_SIZE_DEFAULT, skip: 0, limit: 10, adjusted: false })
    expect(normalizeListPage({}).adjusted).toBe(false)
    expect(normalizeListPage(null).adjusted).toBe(false)
  })

  it('正常入参原样透传', () => {
    expect(normalizeListPage({ page: 2, pageSize: 20 })).toMatchObject({ page: 2, pageSize: 20, skip: 20, limit: 20, adjusted: false })
  })

  it('半传：缺的字段补默认值（不算 adjusted）', () => {
    expect(normalizeListPage({ pageSize: 20 })).toMatchObject({ page: 1, pageSize: 20, skip: 0, limit: 20, adjusted: false })
    expect(normalizeListPage({ page: 3 })).toMatchObject({ page: 3, pageSize: 10, skip: 20, limit: 10, adjusted: false })
  })

  it('page 非数字 → 回落 1（旧实现会让 TypeORM 抛 offset 非数字）', () => {
    const r = normalizeListPage({ page: 'abc', pageSize: 10 })
    expect(r.page).toBe(1)
    expect(Number.isNaN(r.skip)).toBe(false)
    expect(r.adjusted).toBe(true)
  })

  it('page < 1 → 回落 1（旧实现会 2201X OFFSET must not be negative）', () => {
    expect(normalizeListPage({ page: -1, pageSize: 10 }).page).toBe(1)
    expect(normalizeListPage({ page: 0, pageSize: 10 }).adjusted).toBe(true)
  })

  it('pageSize < 1 → 回落 10（旧实现会 2201W / LIMIT 0 静默空页）', () => {
    expect(normalizeListPage({ page: 1, pageSize: -5 }).pageSize).toBe(WALNUT_LIST_PAGE_SIZE_DEFAULT)
    expect(normalizeListPage({ page: 1, pageSize: 0 }).pageSize).toBe(WALNUT_LIST_PAGE_SIZE_DEFAULT)
  })

  it('pageSize 超上限 → 收到 9999（旧实现 1e9 真发出去）', () => {
    expect(normalizeListPage({ page: 1, pageSize: 1e9 }).pageSize).toBe(WALNUT_LIST_PAGE_SIZE_MAX)
  })

  it('小数截断为整数', () => {
    expect(normalizeListPage({ page: 2.7, pageSize: 10.9 })).toMatchObject({ page: 2, pageSize: 10, adjusted: true })
  })

  it('数字字符串可接受（DTO transform 后常见形态）', () => {
    expect(normalizeListPage({ page: '2', pageSize: '20' })).toMatchObject({ page: 2, pageSize: 20, adjusted: false })
  })

  it('永不抛：各种脏输入', () => {
    const dirty = [undefined, null, {}, [], { page: {} }, { page: [] }, { pageSize: {} }, 'x', 3, { page: Number.NaN }, { page: Infinity }]
    for (const input of dirty) {
      expect(() => normalizeListPage(input)).not.toThrow()
      const r = normalizeListPage(input)
      expect(Number.isInteger(r.page)).toBe(true)
      expect(Number.isInteger(r.pageSize)).toBe(true)
      expect(r.page).toBeGreaterThanOrEqual(1)
      expect(r.pageSize).toBeGreaterThanOrEqual(1)
      expect(r.pageSize).toBeLessThanOrEqual(WALNUT_LIST_PAGE_SIZE_MAX)
      expect(r.skip).toBeGreaterThanOrEqual(0)
    }
  })
})
