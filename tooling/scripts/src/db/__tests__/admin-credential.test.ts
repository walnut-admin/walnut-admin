/**
 * `src/db/admin-credential.ts` 的 **identifiers 契约**用例（真实密码学由 seed.test.ts 的握手用例覆盖）。
 *
 * 为什么单独起一份并 mock 掉 `@serenity-kit/opaque`：这里要钉的不是"握手能不能成"，而是
 * **传给库的参数**——注册与登录两侧必须是同一份 identifiers，且与 UI 登录逐字一致
 * （`{ client: 用户名, server: 'walnut-admin' }`）。真实握手在这件事上只会给出一个
 * `client.finishLogin -> undefined`（口令明明是对的），没有参数层面的定位信息。
 *
 * 这条契约的来由（2026-11-24 复核发现）：`buildPasswordIdentity` 曾只做注册、不带
 * identifiers，而 UI 登录带 —— 注册与登录不一致时 `@serenity-kit/opaque` 的行为未定义，
 * 实测就是 `db:seed:pg --admin` 造出来的口令登不进 UI。
 */
import { Buffer } from 'node:buffer'
import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  buildOpaqueIdentifiers,
  buildPasswordIdentity,
  decryptIdentityValue,
  encryptIdentityValue,
  OPAQUE_SERVER_IDENTIFIER,
  verifyPasswordIdentity,
} from '../admin-credential.ts'

/** ① 的加密/哈希入参（形状与后端一致：32 字节 base64 密钥 + 任意盐） */
const ENC_KEY = Buffer.alloc(32, 7).toString('base64')
const HASH_SALT = 'spec-identity-salt'

const opaque = vi.hoisted(() => ({
  startRegistration: vi.fn(() => ({
    clientRegistrationState: 'reg-state',
    registrationRequest: 'reg-request',
  })),
  finishRegistration: vi.fn(() => ({
    registrationRecord: 'registration-record',
    serverStaticPublicKey: 'server-pk',
  })),
  createRegistrationResponse: vi.fn(() => ({ registrationResponse: 'reg-response' })),
  startLogin: vi.fn(() => ({
    clientLoginState: 'login-state',
    startLoginRequest: 'login-request',
  })),
  clientFinishLogin: vi.fn(() => ({ finishLoginRequest: 'finish-request' })),
  serverStartLogin: vi.fn(() => ({
    serverLoginState: 'server-login-state',
    loginResponse: 'login-response',
  })),
  serverFinishLogin: vi.fn(() => ({ sessionKey: 'k'.repeat(86) })),
}))

vi.mock('@serenity-kit/opaque', () => ({
  client: {
    startRegistration: opaque.startRegistration,
    finishRegistration: opaque.finishRegistration,
    startLogin: opaque.startLogin,
    finishLogin: opaque.clientFinishLogin,
  },
  server: {
    createRegistrationResponse: opaque.createRegistrationResponse,
    startLogin: opaque.serverStartLogin,
    finishLogin: opaque.serverFinishLogin,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildOpaqueIdentifiers（注册与登录共用的唯一出口）', () => {
  it('形状就是 UI 登录用的那一份：client = 用户名、server = walnut-admin', () => {
    expect(buildOpaqueIdentifiers('visitor')).toEqual({ client: 'visitor', server: 'walnut-admin' })
  })

  it('与 apps/admin 的 opaqueServerIdentifier 逐字一致（漂移守卫：读真源而不是抄一份）', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'apps/admin/src/store/modules/user/user-auth.ts'),
      'utf8',
    )
    const matched = source.match(/const opaqueServerIdentifier = '([^']+)'/)
    expect(matched?.[1], 'user-auth.ts 里应能定位到 opaqueServerIdentifier 的字面量').toBe(
      OPAQUE_SERVER_IDENTIFIER,
    )
  })
})

describe('buildPasswordIdentity（--admin 注册侧）', () => {
  it('finishRegistration 带上与 UI 登录一致的 identifiers', () => {
    buildPasswordIdentity('u1', 'visitor', 'pw-123456', 'server-setup', ENC_KEY, HASH_SALT)

    expect(opaque.finishRegistration).toHaveBeenCalledTimes(1)
    expect(opaque.finishRegistration).toHaveBeenCalledWith({
      clientRegistrationState: 'reg-state',
      registrationResponse: 'reg-response',
      password: 'pw-123456',
      identifiers: { client: 'visitor', server: 'walnut-admin' },
    })
  })

  it('用户名进入 client identifier（换账号就换 client，server 恒定）', () => {
    buildPasswordIdentity('u1', 'admin', 'pw-123456', 'server-setup', ENC_KEY, HASH_SALT)
    buildPasswordIdentity('u2', 'tron97', 'pw-123456', 'server-setup', ENC_KEY, HASH_SALT)

    expect(opaque.finishRegistration).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        identifiers: { client: 'admin', server: 'walnut-admin' },
      }),
    )
    expect(opaque.finishRegistration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identifiers: { client: 'tron97', server: 'walnut-admin' },
      }),
    )
  })

  it('服务端注册响应仍按 userName 做 userIdentifier（identifiers 不替代它）', () => {
    buildPasswordIdentity('u1', 'visitor', 'pw-123456', 'server-setup', ENC_KEY, HASH_SALT)

    expect(opaque.createRegistrationResponse).toHaveBeenCalledWith({
      serverSetup: 'server-setup',
      userIdentifier: 'visitor',
      registrationRequest: 'reg-request',
    })
  })

  it('①：value 是 AES-GCM 密文（可解密回 registrationRecord），valueHash 是盐化 HMAC（不是 record 本身）', () => {
    const identity = buildPasswordIdentity(
      'u1',
      'visitor',
      'pw-123456',
      'server-setup',
      ENC_KEY,
      HASH_SALT,
    )

    // 落库列 ≠ 明文记录（① 之前两者都是 'registration-record'）
    expect(identity.value).not.toBe('registration-record')
    expect(identity.valueHash).not.toBe('registration-record')
    expect(identity.valueHash).toMatch(/^[0-9a-f]{64}$/)

    // 密文按服务端的 iv || ciphertext || authTag 顺序能还原（AAD = sys_user_identity）
    const data = Buffer.from(identity.value, 'base64')
    const iv = data.subarray(0, 12)
    const tag = data.subarray(data.length - 16)
    const ciphertext = data.subarray(12, data.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'base64'), iv)
    decipher.setAAD(Buffer.from('sys_user_identity', 'utf8'))
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    expect(plain).toBe('registration-record')

    // 明文仍单独留一份给登录自验（不入库）
    expect(identity.registrationRecord).toBe('registration-record')
  })
})

describe('decryptIdentityValue（encryptIdentityValue 的镜像，供 db:credential-check 用）', () => {
  const plain = 'spec-registration-record-用于探针往返'

  it('encrypt → decrypt 往返还原明文（iv || ciphertext || authTag + AAD 同口径）', () => {
    const encrypted = encryptIdentityValue(plain, ENC_KEY)
    expect(decryptIdentityValue(encrypted, ENC_KEY)).toBe(plain)
  })

  it('换一把密钥 ⇒ 解密抛错（AES-GCM auth tag 失败，不返回半截明文）', () => {
    const encrypted = encryptIdentityValue(plain, ENC_KEY)
    const otherKey = Buffer.alloc(32, 9).toString('base64')
    expect(() => decryptIdentityValue(encrypted, otherKey)).toThrowError(
      /unable to authenticate|Unsupported state/,
    )
  })

  it('① 之前的旧明文行（不是信封）⇒ 解密抛错，供探针判 stale-format', () => {
    expect(() => decryptIdentityValue('this-is-a-plain-registration-record', ENC_KEY)).toThrowError(
      /长度不足|unable to authenticate|Unsupported state/,
    )
  })

  it('密钥不是 32 字节 ⇒ 明确报错（不静默解出空串）', () => {
    expect(() => decryptIdentityValue('AAAA', Buffer.alloc(16, 1).toString('base64'))).toThrowError(
      /32 字节/,
    )
  })
})

describe('verifyPasswordIdentity（--admin 自带的登录验证）', () => {
  it('登录两侧也带同一份 identifiers —— 注册绑定了什么，登录就必须原样提供', () => {
    const proof = verifyPasswordIdentity(
      'visitor',
      'pw-123456',
      'registration-record',
      'server-setup',
    )

    expect(proof.ok).toBe(true)
    expect(opaque.serverStartLogin).toHaveBeenCalledWith({
      serverSetup: 'server-setup',
      userIdentifier: 'visitor',
      registrationRecord: 'registration-record',
      startLoginRequest: 'login-request',
      identifiers: { client: 'visitor', server: 'walnut-admin' },
    })
    expect(opaque.clientFinishLogin).toHaveBeenCalledWith({
      clientLoginState: 'login-state',
      loginResponse: 'login-response',
      password: 'pw-123456',
      identifiers: { client: 'visitor', server: 'walnut-admin' },
    })
  })
})
