/**
 * `scripts/data-key.ts` 的纯函数部分 —— dataKey 是「基线漂移」的唯一判据，错了的后果是
 * 要么把无关提交当成漂移（每次都要重封板），要么把数据变化放过去（用旧数据跑新 schema）。
 * git 调用本身是可重跑的环境读数，不在这里测；这里钉住「组合方式」与「porcelain 解析」。
 */
import { describe, expect, it } from 'vitest'
import { baselineCacheKey, combineDataKey, parseDirtyPaths } from './data-key.ts'

const SEED = { path: 'apps/server/db/seed', treeHash: 'a'.repeat(40) }
const MIGRATIONS = { path: 'apps/server/apps/api/migrations', treeHash: 'b'.repeat(40) }

describe('combineDataKey', () => {
  it('同一组路径与树哈希：入参顺序不影响结果', () => {
    expect(combineDataKey([SEED, MIGRATIONS])).toBe(combineDataKey([MIGRATIONS, SEED]))
  })

  it('结果是 64 位小写 hex（sha256）', () => {
    expect(combineDataKey([SEED])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('任一棵树哈希变化 ⇒ key 变化', () => {
    const changed = { ...SEED, treeHash: 'c'.repeat(40) }
    expect(combineDataKey([SEED, MIGRATIONS])).not.toBe(combineDataKey([changed, MIGRATIONS]))
  })

  it('路径名参与哈希：内容不变、改路径（重命名）也改变 key', () => {
    const renamed = { ...SEED, path: 'apps/server/db/seed-v2' }
    expect(combineDataKey([SEED])).not.toBe(combineDataKey([renamed]))
  })

  it('增删路径改变 key（判据是显式的路径清单）', () => {
    expect(combineDataKey([SEED])).not.toBe(combineDataKey([SEED, MIGRATIONS]))
  })
})

describe('baselineCacheKey', () => {
  it('形态是 v<清单版本>-<dataKey>（CI 的 actions/cache 直接消费）', () => {
    expect(baselineCacheKey('a'.repeat(64), 2)).toBe(`v2-${'a'.repeat(64)}`)
  })

  it('清单格式版本变化 ⇒ 键变化（旧格式基线不会被缓存一直命中）', () => {
    expect(baselineCacheKey('a'.repeat(64), 3)).not.toBe(baselineCacheKey('a'.repeat(64), 2))
  })

  it('dataKey 变化 ⇒ 键变化', () => {
    expect(baselineCacheKey('a'.repeat(64), 2)).not.toBe(baselineCacheKey('b'.repeat(64), 2))
  })
})

describe('parseDirtyPaths', () => {
  it('空输出 ⇒ 空列表', () => {
    expect(parseDirtyPaths('')).toEqual([])
    expect(parseDirtyPaths('\n  \n')).toEqual([])
  })

  it('修改 / 未跟踪 / 删除各一行，取 `XY path` 的路径部分', () => {
    const output = [
      ' M apps/server/db/seed/sys_menu.json',
      '?? apps/server/db/seed/new-seed.json',
      'D  apps/server/apps/api/migrations/0001-Old.ts',
    ].join('\n')
    expect(parseDirtyPaths(output)).toEqual([
      'apps/server/db/seed/sys_menu.json',
      'apps/server/db/seed/new-seed.json',
      'apps/server/apps/api/migrations/0001-Old.ts',
    ])
  })

  it('重命名行取新路径（`old -> new`）', () => {
    expect(parseDirtyPaths('R  apps/server/db/seed/a.json -> apps/server/db/seed/b.json')).toEqual([
      'apps/server/db/seed/b.json',
    ])
  })

  it('兼容 CRLF（Windows 的 git 输出）', () => {
    expect(parseDirtyPaths(' M apps/e2e/scripts/prepare-db.ts\r\n')).toEqual(['apps/e2e/scripts/prepare-db.ts'])
  })
})
