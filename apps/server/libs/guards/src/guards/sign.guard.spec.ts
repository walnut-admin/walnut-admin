import type { ExecutionContext } from '@nestjs/common'
import { Buffer } from 'node:buffer'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import {
  WalnutAdminExceptionExpiredSignature,
  WalnutAdminExceptionInvalidSignature,
} from '@walnut-server/exceptions/business/auth'
import { RequestHeaders } from '@walnut/contract/http'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardSign } from './sign.guard'

/**
 * G3 / G4（guard 分支覆盖补齐批）：sign.guard 的拒绝分支单测 ——
 * - G3：必需头缺失、时间戳非数字、ticket cookie 与缓存不一致 40112、AES key 缓存缺失
 *   40113、timingSafeCompare 长度不等 → false（40112）；
 * - G4：已登录（req.user 在场）时双因子派生失败 → 40112（P0-2：不降级单因子）。
 *
 * HTTP 级已由 guard-matrix.api-spec 覆盖「签名篡改 / 时间窗 / nonce / ticket 自动签发」，
 * 这里补的是需要精确构造缓存态、在 HTTP 上要么不可达要么依赖外部时序的分支。
 */

const DEVICE_ID = 'g3-unit-device'
const SIGN_TICKET = 'g3-unit-ticket'
const AES_KEY = 'g3-unit-aes-key'
const NONCE = 'a1b2c3d4e5f60718a1b2c3d4e5f60718'

interface SignGuardMocks {
  getSignTicketCache: ReturnType<typeof vi.fn>
  setSignTicketCache: ReturnType<typeof vi.fn>
  getAesKeyCache: ReturnType<typeof vi.fn>
  setNonceCache: ReturnType<typeof vi.fn>
  deriveApiSignKey: ReturnType<typeof vi.fn>
  runWithLock: ReturnType<typeof vi.fn>
}

interface CreateGuardOptions {
  signTicketCache?: string | null
  aesKey?: string | null
  deriveKey?: Buffer | null
  nonceRecorded?: boolean
}

function createGuard(options: CreateGuardOptions = {}): { guard: WalnutAdminGuardSign, mocks: SignGuardMocks } {
  const mocks: SignGuardMocks = {
    getSignTicketCache: vi.fn(async () => options.signTicketCache ?? null),
    setSignTicketCache: vi.fn(async () => undefined),
    getAesKeyCache: vi.fn(async () => options.aesKey === undefined ? AES_KEY : options.aesKey),
    setNonceCache: vi.fn(async () => options.nonceRecorded ?? true),
    deriveApiSignKey: vi.fn(async () => options.deriveKey === undefined ? Buffer.alloc(32, 7) : options.deriveKey),
    runWithLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  }

  const reflector = { getAllAndOverride: () => false }
  const cookieService = { setResponseCookie: vi.fn() }
  const cacheRsaService = { getRsaPubKeyCache: vi.fn(async () => 'rsa-pub-key') }
  const configService = {
    get: (key: string) => key === 'app.api.prefix' ? 'w' : 'v1',
  }
  const tokenService = { getAccessTokenExpireSeconds: () => 3600 }

  const guard = new WalnutAdminGuardSign(
    reflector as never,
    {
      getSignTicketCache: mocks.getSignTicketCache,
      setSignTicketCache: mocks.setSignTicketCache,
      getAesKeyCache: mocks.getAesKeyCache,
      setNonceCache: mocks.setNonceCache,
    } as never,
    cookieService as never,
    cacheRsaService as never,
    { deriveApiSignKey: mocks.deriveApiSignKey } as never,
    configService as never,
    { runWithLock: mocks.runWithLock } as never,
    tokenService as never,
  )

  return { guard, mocks }
}

interface RequestOptions {
  /** false = 不带 X-Sign 头 */
  sign?: boolean
  timestamp?: string
  nonce?: string
  ua?: string
  /** false = cookie jar 里没有 SIGN_TICKET */
  signTicketCookie?: boolean
  user?: { userId: string, sid: string } | null
}

function createContext(options: RequestOptions = {}): ExecutionContext {
  const headers: Record<string, string> = {}

  if (options.sign !== false) {
    headers[RequestHeaders.SIGN.toLowerCase()] = 'a'.repeat(64)
  }
  if (options.ua !== '') {
    headers[RequestHeaders.USER_AGENT.toLowerCase()] = options.ua ?? 'g3-unit-ua'
  }
  headers[RequestHeaders.NONCE.toLowerCase()] = options.nonce ?? NONCE
  headers[RequestHeaders.TIMESTAMP.toLowerCase()] = options.timestamp ?? String(Date.now())

  const signedCookies: Record<string, string> = {
    [WalnutAdminConstCookieKeys.DEVICE_ID]: DEVICE_ID,
  }
  if (options.signTicketCookie !== false) {
    signedCookies[WalnutAdminConstCookieKeys.SIGN_TICKET] = SIGN_TICKET
  }

  const request = {
    method: 'GET',
    url: '/w/v1/system/user/lock/read',
    body: {},
    headers,
    signedCookies,
    user: options.user ?? null,
  }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function signGuardSpecHandler() {},
    getClass: () => class SignGuardSpecController {},
  } as unknown as ExecutionContext
}

describe('sign guard G3：拒绝分支（头/时间戳/ticket/AES/timing-safe）', () => {
  it('缺 X-Sign 头 → 40112 InvalidSignature（extractRequestMetadata 先拦）', async () => {
    const { guard } = createGuard()

    await expect(guard.canActivate(createContext({ sign: false })))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidSignature)
  })

  it('时间戳非数字（X-Timestamp）→ 40112（Number.isFinite 判定先于时间窗）', async () => {
    const { guard } = createGuard()

    await expect(guard.canActivate(createContext({ timestamp: 'g3-not-a-number' })))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidSignature)
  })

  it('ticket cookie 与缓存不一致 → 40112', async () => {
    const { guard } = createGuard({ signTicketCache: 'cached-ticket' })

    await expect(guard.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidSignature)
  })

  it('aes key 缓存缺失（含 ticket 自动补发路径）→ 40113 ExpiredSignature', async () => {
    const { guard, mocks } = createGuard({ signTicketCache: null, aesKey: null })

    await expect(guard.canActivate(createContext({ signTicketCookie: false })))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionExpiredSignature)

    // ticket 缓存缺失走分布式锁生成新票（真实路径），随后才在 AES key 处失败
    expect(mocks.runWithLock).toHaveBeenCalledTimes(1)
    expect(mocks.setSignTicketCache).toHaveBeenCalledTimes(1)
  })

  it('timingSafeCompare 长度不等 → false → 40112（不再进入 timingSafeEqual）', async () => {
    const { guard } = createGuard({ signTicketCache: SIGN_TICKET })

    // sign 头只有 8 位 vs 服务端 64 位 hex
    const context = createContext({ sign: true })
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    request.headers[RequestHeaders.SIGN.toLowerCase()] = 'deadbeef'

    await expect(guard.canActivate(context))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidSignature)
  })
})

describe('sign guard G4：已登录双因子派生失败不降级（P0-2）', () => {
  it('req.user 在场 + deriveApiSignKey 返回 null → 40112（不再回落单因子）', async () => {
    const { guard, mocks } = createGuard({
      signTicketCache: SIGN_TICKET,
      deriveKey: null,
    })

    await expect(guard.canActivate(createContext({
      user: { userId: 'g4-user', sid: 'g4-sid' },
    }))).rejects.toBeInstanceOf(WalnutAdminExceptionInvalidSignature)

    expect(mocks.deriveApiSignKey).toHaveBeenCalledWith('g4-user', DEVICE_ID, 'g4-sid', AES_KEY)
  })

  it('req.user 缺失时仍走单因子（登录/握手端点不受影响）', async () => {
    const { guard, mocks } = createGuard({
      signTicketCache: SIGN_TICKET,
      deriveKey: null,
    })

    // 单因子签名与 mock 的 sign 头不匹配 → 40112，但派生腿未被调用即证明未走双因子
    await expect(guard.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidSignature)

    expect(mocks.deriveApiSignKey).not.toHaveBeenCalled()
  })
})
