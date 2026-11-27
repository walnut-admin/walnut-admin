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
    profile: 'default',
    database: 'walnut_e2e',
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
  it('版本 3 的完整清单通过', () => {
    expect(isBaselineManifest(validManifest())).toBe(true)
  })

  it('版本 2（旧格式，缺 profile / database）不通过 —— 旧清单不做迁移', () => {
    const legacy = { ...validManifest(), manifestVersion: 2 }
    expect(isBaselineManifest(legacy)).toBe(false)
  })

  it('命名 profile 的库名通过（形状正则与 env.ts 同口径）', () => {
    expect(isBaselineManifest({ ...validManifest(), profile: 'risk', database: 'walnut_e2e_risk' })).toBe(true)
  })

  it.each([
    ['dataKey 缺失', { dataKey: undefined }],
    ['dataKey 不是 64 位 hex', { dataKey: 'xyz' }],
    ['dataDirty 不是布尔', { dataDirty: 'false' }],
    ['profile 缺失', { profile: undefined }],
    ['profile 含大写 / 非法字符', { profile: 'Smoke_1' }],
    ['database 缺失', { database: undefined }],
    ['database 不是 E2E 库名形态', { database: 'walnut_pg' }],
    ['database 用了非法后缀', { database: 'walnut_e2e_fooBar' }],
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
