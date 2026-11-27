/**
 * `db:credential-check` 的纯函数用例：解密镜像的调用口径、stale 三类判定、报表行构造。
 *
 * 真库只在真机验证时连（不在单测里连 PG）；这里全部是可注入的纯函数，CI 上零外部依赖。
 */
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { encryptIdentityValue, hashIdentityValue } from '../admin-credential.ts'
import {
  analyzePasswordIdentity,
  formatCredentialCheckReport,
  hasCredentialProblem,
  looksLikeRegistrationRecord,
  parseCredentialCheckArgs,
} from '../credential-check.ts'

const KEYS = {
  encryptionKey: Buffer.alloc(32, 7).toString('base64'),
  hashSalt: 'spec-identity-salt',
}
const USER_ID = '11111111-1111-4111-8111-111111111111'

/** 形状像 OPAQUE registration record 的假记录（256 字符、base64url，含 `-` / `_`） */
const FAKE_RECORD = `${'A'.repeat(252)}-_==`
const ENCRYPTED_RECORD = encryptIdentityValue(FAKE_RECORD, KEYS.encryptionKey)
const RECORD_HASH = hashIdentityValue(FAKE_RECORD, KEYS.hashSalt)

function row(overrides: Partial<Parameters<typeof analyzePasswordIdentity>[0]> = {}) {
  return {
    userName: 'alice',
    userId: USER_ID,
    value: ENCRYPTED_RECORD,
    valueHash: RECORD_HASH,
    ...overrides,
  }
}

describe('decrypt 镜像与记录形状', () => {
  it('真记录形状：256 字符 base64url（含 - / _）判为 OPAQUE 记录', () => {
    expect(FAKE_RECORD).toHaveLength(256)
    expect(looksLikeRegistrationRecord(FAKE_RECORD)).toBe(true)
  })

  it('普通文本 / JSON / 空串不是 OPAQUE 记录（不把解出来的任意内容当凭证）', () => {
    expect(looksLikeRegistrationRecord('plain old password record')).toBe(false)
    expect(looksLikeRegistrationRecord('{"a":1}')).toBe(false)
    expect(looksLikeRegistrationRecord('')).toBe(false)
    expect(looksLikeRegistrationRecord('A'.repeat(60))).toBe(false) // 长度不够
  })
})

describe('analyzePasswordIdentity：stale 三类判定', () => {
  it('ok：密文可解 + valueHash 一致 ⇒ 不报问题，建议列是 —', () => {
    const result = analyzePasswordIdentity(row(), KEYS)
    expect(result).toMatchObject({ userName: 'alice', userId: USER_ID, format: 'ok', hashMatch: true, suggestion: '—' })
    expect(hasCredentialProblem(result)).toBe(false)
  })

  it('stale-format：value 是旧明文（不是 AES 信封）⇒ 解密失败，hash 不可校验', () => {
    const result = analyzePasswordIdentity(row({ value: FAKE_RECORD }), KEYS)
    expect(result.format).toBe('stale-format')
    expect(result.hashMatch).toBeNull()
    expect(result.detail).toContain('AES-GCM 解密失败')
    expect(result.suggestion).toContain('pnpm walnut db:seed:pg --admin alice')
    expect(hasCredentialProblem(result)).toBe(true)
  })

  it('stale-format：换过 USER_ID_ENCRYPTION_KEY ⇒ 解密失败', () => {
    const otherKeys = { ...KEYS, encryptionKey: Buffer.alloc(32, 9).toString('base64') }
    const result = analyzePasswordIdentity(row(), otherKeys)
    expect(result.format).toBe('stale-format')
    expect(hasCredentialProblem(result)).toBe(true)
  })

  it('stale-format：解密成功但内容不是 base64url 记录（格式漂移）', () => {
    const result = analyzePasswordIdentity(
      row({ value: encryptIdentityValue('not a registration record', KEYS.encryptionKey) }),
      KEYS,
    )
    expect(result.format).toBe('stale-format')
    expect(result.detail).toContain('不是 base64url')
  })

  it('missing-identity：value 为空 ⇒ 判缺失并给修复命令', () => {
    const result = analyzePasswordIdentity(row({ value: '' }), KEYS)
    expect(result.format).toBe('missing-identity')
    expect(result.hashMatch).toBeNull()
    expect(result.suggestion).toContain('pnpm walnut db:seed:pg --admin alice')
    expect(hasCredentialProblem(result)).toBe(true)
  })

  it('hash 不一致：格式仍 ok，但 hashMatch=false 且命令判问题（可机检）', () => {
    const result = analyzePasswordIdentity(row({ valueHash: 'deadbeef' }), KEYS)
    expect(result.format).toBe('ok')
    expect(result.hashMatch).toBe(false)
    expect(result.detail).toContain('valueHash')
    expect(result.suggestion).toContain('pnpm walnut db:seed:pg --admin alice')
    expect(hasCredentialProblem(result)).toBe(true)
  })
})

describe('formatCredentialCheckReport：输出行构造', () => {
  it('表头 + 每行账号 / userId / 格式 / valueHash / 建议；不出现密文与明文', () => {
    const ok = analyzePasswordIdentity(row(), KEYS)
    const stale = analyzePasswordIdentity(row({ userName: 'visitor', userId: '22222222-2222-4222-8222-222222222222', value: FAKE_RECORD }), KEYS)

    const lines = formatCredentialCheckReport([ok, stale])

    expect(lines[0]).toContain('账号')
    expect(lines[0]).toContain('userId')
    expect(lines[0]).toContain('格式')
    expect(lines[0]).toContain('valueHash')
    expect(lines[0]).toContain('建议')

    const okLine = lines.find(line => line.includes('alice'))!
    expect(okLine).toContain(USER_ID)
    expect(okLine).toContain('ok')
    expect(okLine).toContain('一致')

    const staleLine = lines.find(line => line.includes('visitor'))!
    expect(staleLine).toContain('stale-format')
    expect(staleLine).toContain('不可校验')

    const report = lines.join('\n')
    expect(report).not.toContain(FAKE_RECORD)
    expect(report).not.toContain(ENCRYPTED_RECORD)
    expect(report).not.toContain(RECORD_HASH)
  })

  it('join 不到用户时用占位账号名，且照样给出可执行建议', () => {
    const result = analyzePasswordIdentity(row({ userName: null }), KEYS)
    const [header, separator, body] = formatCredentialCheckReport([result])
    expect(header).toBeDefined()
    expect(separator).toContain('-')
    expect(body).toContain('(未关联用户)')
  })
})

describe('parseCredentialCheckArgs', () => {
  it('支持 --pg-db / --env-file（与 db:seed:pg 同风格），默认 envFile 为空（走 NODE_ENV 解析）', () => {
    expect(parseCredentialCheckArgs([])).toEqual({ envFile: '' })
    expect(parseCredentialCheckArgs(['--pg-db', 'walnut_pg', '--env-file', 'apps/server/env-local/.env.development']))
      .toEqual({ pgDbName: 'walnut_pg', envFile: 'apps/server/env-local/.env.development' })
  })

  it('未知参数与缺值都明确报错（不静默吞掉）', () => {
    expect(() => parseCredentialCheckArgs(['--dry-run'])).toThrowError(/未知参数/)
    expect(() => parseCredentialCheckArgs(['--pg-db'])).toThrowError(/缺参数值/)
  })
})
