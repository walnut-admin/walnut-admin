import { Buffer } from 'node:buffer'
import { JwtService } from '@nestjs/jwt'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTokenService } from '@walnut-server/token'
import { Role } from '@walnut/contract'
import { RequestHeaders } from '@walnut/contract/http'
import { describe, expect, it, vi } from 'vitest'
import { SocketAuthMiddleware } from '../socket.middleware'

/**
 * F-02（socket 握手三重校验）单测：
 * - 伪造签名 / 过期真 token / Redis 会话键缺失 → next(new Error) 且不挂 socket.data
 *   （握手被拒 ⇒ socket.io 不进入 connection ⇒ 不 join 任何房间）；
 * - 有效 token + 会话在场 → next() 无参通过，socket.data 挂上 userId/deviceId/fingerprint。
 *
 * cookie 解析分支：cookie-parser 对已存在 req.cookies 的请求提前 return，所以预置
 * signedCookies 即可注入 deviceId —— 本单测只覆盖鉴权决策，不重复验证 express 解析。
 */

const ACCESS_SECRET = 'socket-middleware-spec-access-secret'
const FINGERPRINT_HEADER = RequestHeaders.FINGERPRINT.toLowerCase()

function makePayload() {
  return {
    userId: 'spec-user',
    userName: 'spec',
    roleIds: [],
    roleNames: [Role.ADMIN],
    currentRole: 'role-1',
    roleMode: 'normal',
    currentRoleName: Role.ADMIN,
    mfaSetup: false,
    mfaVerified: false,
    sid: 'spec-sid',
  }
}

function createTokenService() {
  return new AppTokenService(
    new JwtService({ secret: ACCESS_SECRET }),
    {
      get: (key: string) =>
        key === 'jwt.access.secret'
          ? ACCESS_SECRET
          : key === 'jwt.access.expire'
            ? 3600
            : undefined,
    } as never,
  )
}

interface SocketOptions {
  token?: string
  /** false = 请求不带设备 cookie（无法构造会话键） */
  deviceCookie?: boolean
}

function createSocket(options: SocketOptions = {}) {
  const signedCookies: Record<string, string> = {}
  if (options.deviceCookie !== false) {
    signedCookies[WalnutAdminConstCookieKeys.DEVICE_ID] = 'spec-device-id'
  }

  return {
    request: {
      headers: { [FINGERPRINT_HEADER]: 'spec-fingerprint' },
      cookies: {},
      signedCookies,
    },
    handshake: {
      headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
    },
    data: undefined as undefined | Record<string, unknown>,
  }
}

/**
 * @param sessionKeyHash Redis 会话键命中值（null = 会话不存在）
 * @param deviceState 设备缓存内容（拍板-4 的设备状态闸门）；null = 缓存 miss 且库里也没有
 */
function createMiddleware(
  sessionKeyHash: Buffer | null = Buffer.alloc(32, 3),
  deviceState: { banned: boolean, locked: boolean } | null = { banned: false, locked: false },
) {
  const getSession = vi.fn(async () => sessionKeyHash)
  const getDeviceCache = vi.fn(async () => deviceState)
  const deviceRepo = { findDeviceByDeviceId: vi.fn(async () => null) }
  const middleware = new SocketAuthMiddleware(
    { get: (key: string) => (key === 'app.cookie.secret' ? 'spec-cookie-secret' : undefined) } as never,
    createTokenService(),
    { getAuthSessionKeyHash: getSession } as never,
    { getSysDeviceCache: getDeviceCache, setSysDeviceCache: vi.fn() } as never,
    deviceRepo as never,
  )

  return { middleware, getSession, getDeviceCache }
}

describe('socketAuthMiddleware：F-02 握手验签（伪造/过期/会话缺失一律拒绝）', () => {
  it('自编 payload + 垃圾签名（错误 secret）→ next(Error)，不挂 socket.data，不查会话', async () => {
    const { middleware, getSession } = createMiddleware()
    const forged = await new JwtService({ secret: 'attacker-secret' }).signAsync(makePayload())
    const socket = createSocket({ token: forged })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
    // 验签失败短路：不触碰 Redis 会话键
    expect(getSession).not.toHaveBeenCalled()
  })

  it('过期真 token（正确 secret 签发）→ next(Error)，不挂 socket.data', async () => {
    const { middleware } = createMiddleware()
    const expired = await new JwtService({ secret: ACCESS_SECRET }).signAsync(makePayload(), { expiresIn: '-10s' })
    const socket = createSocket({ token: expired })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
  })

  it('签名有效未过期但 Redis 会话键缺失（登出/吊销）→ next(Error)', async () => {
    const { middleware } = createMiddleware(null)
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
  })

  it('有效 token + 会话在场 → next() 无参通过，socket.data 挂上三元组', async () => {
    const { middleware, getSession } = createMiddleware()
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeUndefined()
    expect(socket.data).toEqual({
      userId: 'spec-user',
      deviceId: 'spec-device-id',
      fingerprint: 'spec-fingerprint',
    })
    expect(getSession).toHaveBeenCalledWith('spec-user', 'spec-device-id', 'spec-sid')
  })

  it('设备 cookie 缺失 → 无法构造会话键 → next(Error)', async () => {
    const { middleware, getSession } = createMiddleware()
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token, deviceCookie: false })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
  })

  // 拍板-4（封禁 = 踢下线）：握手要多看一道设备状态 —— 之前只验 JWT + 会话键，
  // 已封设备照样建连收实时事件。
  it('设备被封禁（banned）→ next(Error)，不挂 socket.data', async () => {
    const { middleware } = createMiddleware(undefined, { banned: true, locked: false })
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect((next.mock.calls[0]?.[0] as Error).message).toBe('Device banned')
    expect(socket.data).toBeUndefined()
  })

  it('设备被锁定（locked）→ next(Error)，不挂 socket.data', async () => {
    const { middleware } = createMiddleware(undefined, { banned: false, locked: true })
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect((next.mock.calls[0]?.[0] as Error).message).toBe('Device locked')
    expect(socket.data).toBeUndefined()
  })

  it('设备行不存在（缓存 miss + DB 无行）→ next(Error)', async () => {
    const { middleware } = createMiddleware(undefined, null)
    const token = await createTokenService().generateJwtAccessToken(makePayload())
    const socket = createSocket({ token })
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
  })

  it('无 Bearer token → next(Error)（既有行为保持）', async () => {
    const { middleware } = createMiddleware()
    const socket = createSocket()
    const next = vi.fn()

    await middleware.middleware(socket as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(socket.data).toBeUndefined()
  })
})
