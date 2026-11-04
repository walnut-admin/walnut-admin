import { JwtService } from '@nestjs/jwt'
import { Role } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import { AppTokenService } from '../token.service'

/**
 * F-02（socket 握手验签）配套单测：verifyAccessToken 必须走 verifyAsync
 * （验签名 + 过期），任何校验失败一律返回 null —— 与 decodeAccessToken
 * （只 Base64 解码、不验签）形成对照。伪造 token / 过期 token 在这里必须红。
 */

const ACCESS_SECRET = 'token-service-spec-access-secret'

function createService() {
  const configService = {
    get: (key: string) =>
      key === 'jwt.access.secret'
        ? ACCESS_SECRET
        : key === 'jwt.access.expire'
          ? 3600
          : undefined,
  }

  return new AppTokenService(new JwtService({ secret: ACCESS_SECRET }), configService as never)
}

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

describe('appTokenService.verifyAccessToken（F-02 验签）', () => {
  it('正确 secret 签发的有效 token → 返回 payload', async () => {
    const service = createService()

    const payload = await service.verifyAccessToken(await service.generateJwtAccessToken(makePayload()))

    expect(payload?.userId).toBe('spec-user')
    expect(payload?.sid).toBe('spec-sid')
  })

  it('自编 payload + 错误 secret 签名（伪造 token）→ null', async () => {
    const service = createService()
    const forged = await new JwtService({ secret: 'attacker-secret' }).signAsync(makePayload())

    await expect(service.verifyAccessToken(forged)).resolves.toBeNull()
  })

  it('篡改 payload 段（签名不匹配）→ null', async () => {
    const service = createService()
    const token = await service.generateJwtAccessToken(makePayload())
    const parts = token.split('.')
    const tail = parts[1].slice(-2)
    parts[1] = parts[1].slice(0, -2) + (tail === 'AA' ? 'BB' : 'AA')

    await expect(service.verifyAccessToken(parts.join('.'))).resolves.toBeNull()
  })

  it('过期真 token（正确 secret、exp 在过去）→ null', async () => {
    const service = createService()
    const expired = await new JwtService({ secret: ACCESS_SECRET }).signAsync(makePayload(), { expiresIn: '-10s' })

    await expect(service.verifyAccessToken(expired)).resolves.toBeNull()
  })

  it('非 JWT 垃圾串 → null（不抛出）', async () => {
    const service = createService()

    await expect(service.verifyAccessToken('garbage-not-a-jwt')).resolves.toBeNull()
  })
})
