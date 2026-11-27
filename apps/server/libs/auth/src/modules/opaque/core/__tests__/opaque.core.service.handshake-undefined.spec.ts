import type { EntityManager } from 'typeorm'
import { Logger } from '@nestjs/common'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthOpaqueCoreService } from '../opaque.core.service'

/**
 * 方案 a 的第三类失败：**OPAQUE 计算没有产出 loginResponse**（`server.startLogin` 返回
 * undefined / 空串）。类型上不可达，是服务端能观察到的、与「identifiers 旧口径」最接近的
 * 形态（真正的 identifiers 不一致发生在客户端 `client.finishLogin`，服务端拿不到信号）。
 *
 * 为什么单独一份文件：`opaque.server.startLogin` 是 ESM 的非可配置导出，`vi.spyOn` 会报
 * `Cannot redefine property`；而 `vi.mock` 是文件级 hoist 的，放进主用例文件会污染那批
 * **真实密码学**断言。这里把整个包换成最小替身，只钉这一条分支。
 */

const APP_NAME = 'spec-app'
const USER_NAME = 'alice'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const DEVICE_ID = 'spec-device'

const mockState = vi.hoisted(() => ({
  loginResponse: undefined as string | undefined,
}))

vi.mock('@serenity-kit/opaque', () => ({
  ready: Promise.resolve(),
  client: {
    startLogin: vi.fn(() => ({
      clientLoginState: 'client-state',
      startLoginRequest: 'start-request',
    })),
  },
  server: {
    createSetup: vi.fn(() => 'server-setup'),
    startLogin: vi.fn(() => ({
      serverLoginState: 'server-login-state',
      loginResponse: mockState.loginResponse,
    })),
  },
}))

const warnSpy = vi.spyOn(Logger.prototype, 'warn')

const EM = { marker: 'entity-manager' } as unknown as EntityManager

function createService(nodeEnv: string) {
  const setOpaqueServerStateCache = vi.fn(async () => undefined)
  const service = new AuthOpaqueCoreService(
    { setOpaqueServerStateCache } as never,
    {
      get: (key: string) =>
        key === 'jwt.opaque.secret'
          ? 'server-setup'
          : key === 'app.name'
            ? APP_NAME
            : key === 'NODE_ENV'
              ? nodeEnv
              : undefined,
    } as never,
    {} as never,
    { findUserByUserName: vi.fn(async () => ({ id: USER_ID, userName: USER_NAME })) } as never,
    { getValueByUserIdTypeAndPurpose: vi.fn(async () => 'enc:record') } as never,
    {
      decryptValue: vi.fn(() => 'registration-record'),
    } as never,
  )
  return { service, setOpaqueServerStateCache }
}

beforeEach(() => {
  mockState.loginResponse = undefined
  warnSpy.mockClear()
})

describe('opaque.core.startLogin：OPAQUE 握手没有产出（方案 a）', () => {
  it('loginResponse 为 undefined：照常写一次 SERVER_STATE，日志 reason=credential-handshake-undefined，dev 附 hint', async () => {
    const { service, setOpaqueServerStateCache } = createService('development')

    const caught = await service
      .startLogin(USER_NAME, 'start-request', DEVICE_ID, EM)
      .catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    // 等时性：握手阶段不抛，缓存写仍然发生（与成功 / fake 路径同量）
    expect(setOpaqueServerStateCache).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason: credential-handshake-undefined'),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`pnpm walnut db:seed:pg --admin ${USER_NAME}`),
    )

    const meta = (caught as { getResponse: () => { meta?: Record<string, string> } }).getResponse()
      .meta!
    expect(meta.reason).toBe('credential-handshake-undefined')
    expect(meta.hint).toContain(`pnpm walnut db:seed:pg --admin ${USER_NAME}`)
  })

  it('production：同一失败不改变响应（无 meta），但日志仍可定位', async () => {
    const { service } = createService('production')

    const caught = await service
      .startLogin(USER_NAME, 'start-request', DEVICE_ID, EM)
      .catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    const meta = (caught as { getResponse: () => { meta?: Record<string, string> } }).getResponse()
      .meta
    expect(meta).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credential-handshake-undefined'))
  })
})
