/**
 * `scripts/baseline-manifest.ts` 的形态校验 —— restore 的安全前提。
 * 每条用例对应一种「坏清单」：少校验一项，坏文件就可能被当成基线恢复进库。
 */
import type { BaselineManifest } from './baseline-manifest.ts'
import { describe, expect, it } from 'vitest'
import { isBaselineManifest, MANIFEST_VERSION, manifestVersionOf } from './baseline-manifest.ts'

function validManifest(): BaselineManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    sealedAt: '2026-11-25T00:00:00.000Z',
    gitCommit: 'a'.repeat(40),
    dataKey: 'b'.repeat(64),
    dataDirty: false,
    migrationsHead: { id: 9, name: '1792922206018-InitSchema' },
    dumpSha256: 'c'.repeat(64),
    dumpBytes: 1234,
    credentialsSha256: 'd'.repeat(64),
    credentialsBytes: 321,
    menuRows: 42,
  }
}

describe('isBaselineManifest', () => {
  it('版本 2 的完整清单通过', () => {
    expect(isBaselineManifest(validManifest())).toBe(true)
  })

  it('版本 1（旧格式）不通过 —— 旧清单不做迁移', () => {
    const legacy = { ...validManifest(), manifestVersion: 1 }
    expect(isBaselineManifest(legacy)).toBe(false)
  })

  it.each([
    ['dataKey 缺失', { dataKey: undefined }],
    ['dataKey 不是 64 位 hex', { dataKey: 'xyz' }],
    ['dataDirty 不是布尔', { dataDirty: 'false' }],
    ['dumpSha256 不是 64 位 hex', { dumpSha256: 'c'.repeat(63) }],
    ['dumpBytes 为 0', { dumpBytes: 0 }],
    ['credentialsSha256 缺失', { credentialsSha256: undefined }],
    ['credentialsBytes 不是整数', { credentialsBytes: 1.5 }],
    ['gitCommit 不是 40 位', { gitCommit: 'a'.repeat(39) }],
    ['migrationsHead 缺 name', { migrationsHead: { id: 1 } }],
    ['menuRows 为负', { menuRows: -1 }],
    ['sealedAt 为空串', { sealedAt: '' }],
  ])('%s ⇒ 不通过', (_label, patch) => {
    expect(isBaselineManifest({ ...validManifest(), ...patch })).toBe(false)
  })

  it('非对象（null / 数组 / 字符串）不通过', () => {
    expect(isBaselineManifest(null)).toBe(false)
    expect(isBaselineManifest([])).toBe(false)
    expect(isBaselineManifest('manifest')).toBe(false)
  })
})

describe('manifestVersionOf', () => {
  it('数字版本号原样返回（用于区分「旧格式」与「损坏」）', () => {
    expect(manifestVersionOf({ manifestVersion: 1 })).toBe(1)
    expect(manifestVersionOf({ manifestVersion: 2 })).toBe(2)
  })

  it('没有数字版本号 ⇒ null', () => {
    expect(manifestVersionOf({})).toBeNull()
    expect(manifestVersionOf({ manifestVersion: '2' })).toBeNull()
    expect(manifestVersionOf(null)).toBeNull()
  })
})
