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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  buildOpaqueIdentifiers,
  buildPasswordIdentity,
  OPAQUE_SERVER_IDENTIFIER,
  verifyPasswordIdentity,
} from '../admin-credential.ts'

const opaque = vi.hoisted(() => ({
  startRegistration: vi.fn(() => ({ clientRegistrationState: 'reg-state', registrationRequest: 'reg-request' })),
  finishRegistration: vi.fn(() => ({ registrationRecord: 'registration-record', serverStaticPublicKey: 'server-pk' })),
  createRegistrationResponse: vi.fn(() => ({ registrationResponse: 'reg-response' })),
  startLogin: vi.fn(() => ({ clientLoginState: 'login-state', startLoginRequest: 'login-request' })),
  clientFinishLogin: vi.fn(() => ({ finishLoginRequest: 'finish-request' })),
  serverStartLogin: vi.fn(() => ({ serverLoginState: 'server-login-state', loginResponse: 'login-response' })),
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
    const source = readFileSync(join(REPO_ROOT, 'apps/admin/src/store/modules/user/user-auth.ts'), 'utf8')
    const matched = source.match(/const opaqueServerIdentifier = '([^']+)'/)
    expect(matched?.[1], 'user-auth.ts 里应能定位到 opaqueServerIdentifier 的字面量').toBe(OPAQUE_SERVER_IDENTIFIER)
  })
})

describe('buildPasswordIdentity（--admin 注册侧）', () => {
  it('finishRegistration 带上与 UI 登录一致的 identifiers', () => {
    buildPasswordIdentity('u1', 'visitor', 'pw-123456', 'server-setup')

    expect(opaque.finishRegistration).toHaveBeenCalledTimes(1)
    expect(opaque.finishRegistration).toHaveBeenCalledWith({
      clientRegistrationState: 'reg-state',
      registrationResponse: 'reg-response',
      password: 'pw-123456',
      identifiers: { client: 'visitor', server: 'walnut-admin' },
    })
  })

  it('用户名进入 client identifier（换账号就换 client，server 恒定）', () => {
    buildPasswordIdentity('u1', 'admin', 'pw-123456', 'server-setup')
    buildPasswordIdentity('u2', 'tron97', 'pw-123456', 'server-setup')

    expect(opaque.finishRegistration).toHaveBeenNthCalledWith(1, expect.objectContaining({
      identifiers: { client: 'admin', server: 'walnut-admin' },
    }))
    expect(opaque.finishRegistration).toHaveBeenNthCalledWith(2, expect.objectContaining({
      identifiers: { client: 'tron97', server: 'walnut-admin' },
    }))
  })

  it('服务端注册响应仍按 userName 做 userIdentifier（identifiers 不替代它）', () => {
    buildPasswordIdentity('u1', 'visitor', 'pw-123456', 'server-setup')

    expect(opaque.createRegistrationResponse).toHaveBeenCalledWith({
      serverSetup: 'server-setup',
      userIdentifier: 'visitor',
      registrationRequest: 'reg-request',
    })
  })
})

describe('verifyPasswordIdentity（--admin 自带的登录验证）', () => {
  it('登录两侧也带同一份 identifiers —— 注册绑定了什么，登录就必须原样提供', () => {
    const proof = verifyPasswordIdentity('visitor', 'pw-123456', 'registration-record', 'server-setup')

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
