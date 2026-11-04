import { JwtService } from '@nestjs/jwt'
import { WalnutAdminExceptionAccessTokenExpired } from '@walnut-server/exceptions/business/auth'
import { describe, expect, it } from 'vitest'
import { JwtAccessTokenStrategy } from '../jwt-access.strategy'

/**
 * F-42（验签算法钉死，HTTP 侧）：`jwt-access.strategy` 把 options 原样交给 passport-jwt，
 * 后者再透传给 jsonwebtoken 的 verify —— 不显式给 algorithms 时算法由 token header 的 alg
 * 决定（算法降级面）。本文件直接驱动 strategy.authenticate（套接 passport 的
 * success / fail / error 三出口），钉死四件事：
 * 1) _verifOpts.algorithms === ['HS256']、ignoreExpiration 仍为 false；
 * 2) HS256 有效签名 → 签名层通过（走到 validate 的会话检查并抛 40101）；
 * 3) 同一 secret 但 HS512 签发 → passport 直接 fail（签名层就拒，不进 validate）；
 * 4) 错误 secret 伪造 → 同样 fail（既有行为不回归）。
 */

const ACCESS_SECRET = 'jwt-access-strategy-spec-secret-0123456789'

interface IStrategyOutcome {
  kind: 'success' | 'fail' | 'error'
  payload?: unknown
}

function createStrategy() {
  const configService = { get: () => ACCESS_SECRET }
  // 会话键一律 miss：让「签名层通过」表现为 validate 抛 40101（区别于点 validate 之前就 fail）
  const sessionService = { getAuthSessionKeyHash: async () => null }

  return new JwtAccessTokenStrategy(configService as never, sessionService as never)
}

async function authenticate(strategy: JwtAccessTokenStrategy, token?: string) {
  return new Promise<IStrategyOutcome>((resolve) => {
    const req = {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      signedCookies: {},
    }

    Object.assign(strategy, {
      success: (user: unknown) => resolve({ kind: 'success', payload: user }),
      fail: (challenge: unknown) => resolve({ kind: 'fail', payload: challenge }),
      error: (error: unknown) => resolve({ kind: 'error', payload: error }),
    })

    strategy.authenticate(req as never, {})
  })
}

async function signHs512() {
  return new JwtService({}).signAsync(
    { userId: 'spec-user' },
    { secret: ACCESS_SECRET, algorithm: 'HS512' },
  )
}

describe('jwt-access.strategy：验签算法钉死 HS256（F-42）', () => {
  it('_verifOpts：algorithms 只有 HS256，ignoreExpiration 仍为 false', () => {
    const strategy = createStrategy() as unknown as { _verifOpts: Record<string, unknown> }

    expect(strategy._verifOpts.algorithms).toEqual(['HS256'])
    expect(strategy._verifOpts.ignoreExpiration).toBe(false)
  })

  it('用 HS256 有效签名 → 签名层通过（走进 validate，会话缺失 ⇒ 40101 经 error 出口）', async () => {
    const strategy = createStrategy()
    const token = await new JwtService({}).signAsync(
      { userId: 'spec-user', sid: 'sid-1' },
      { secret: ACCESS_SECRET },
    )

    const outcome = await authenticate(strategy, token)

    expect(outcome.kind).toBe('error')
    expect(outcome.payload).toBeInstanceOf(WalnutAdminExceptionAccessTokenExpired)
  })

  it('用 HS512 签发（同一把 secret）→ fail（在 validate 之前被算法白名单拒掉）', async () => {
    const strategy = createStrategy()
    const outcome = await authenticate(strategy, await signHs512())

    expect(outcome.kind).toBe('fail')
    expect(outcome.payload).not.toBeInstanceOf(WalnutAdminExceptionAccessTokenExpired)
    expect(String(outcome.payload)).toMatch(/invalid algorithm/i)
  })

  it('错误 secret 伪造的 HS256 token → fail（既有行为不回归）', async () => {
    const strategy = createStrategy()
    const forged = await new JwtService({}).signAsync(
      { userId: 'attacker' },
      { secret: 'attacker-secret' },
    )

    const outcome = await authenticate(strategy, forged)

    expect(outcome.kind).toBe('fail')
  })

  it('缺 Authorization 头 → fail（不抛、不 success）', async () => {
    const strategy = createStrategy()

    await expect(authenticate(strategy)).resolves.toMatchObject({ kind: 'fail' })
  })
})
