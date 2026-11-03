/**
 * D16② 的机械守卫：locale **list 行**的分组键叫 `groupKey`，wire 上不能再有 `id`。
 *
 * 为什么值得一条用例：这个字段是 Mongo `$group._id` 的直译（= i18n key），却曾经叫 `id` ——
 * 前端 `rowKey` 与 read/delete 的路径参数都用它，一旦有人把它"规整"回 `id`，
 * 「列表行的 id 是 uuid 主键」这个跨 19 个 list 的约定就被悄悄破坏了（而没有任何报错）。
 */
import { describe, expect, it } from 'vitest'
import { toLocaleListGroupRow } from './repo/locale.repo.service'

const ROW = {
  key: 'app.base.yes',
  process: 0.5,
  created_at: new Date('2020-11-24T13:54:44.222Z'),
  updated_at: new Date('2026-02-04T13:23:50.601Z'),
}

describe('toLocaleListGroupRow（locale list 行的 wire 形态）', () => {
  it('分组键是 groupKey（= key），**没有** id 键', () => {
    const row = toLocaleListGroupRow(ROW)
    expect(row.groupKey).toBe('app.base.yes')
    expect(row.key).toBe('app.base.yes')
    expect(Object.keys(row)).toEqual(['groupKey', 'key', 'process', 'createdAt', 'updatedAt'])
    expect(row).not.toHaveProperty('id')
  })

  it('process 是 0..1 小数（PG 侧 float8），createdAt/updatedAt 保持 Date', () => {
    const row = toLocaleListGroupRow(ROW)
    expect(row.process).toBe(0.5)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('numeric 字符串形态也能吃（manager.query 的返回值形态由驱动决定）', () => {
    expect(toLocaleListGroupRow({ ...ROW, process: '0.25' }).process).toBe(0.25)
  })
})
