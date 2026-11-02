import { JwtService } from '@nestjs/jwt'
import { describe, expect, it } from 'vitest'
import { JwtConfigClass } from './jwt.config'

/**
 * F-42（验签算法钉死，libs/token 侧）：JwtConfigClass 是 `@walnut-server/token` 的
 * JwtModule.registerAsync 选项工厂，`AppTokenService.verifyAccessToken`、socket 握手、
 * 以及所有 `jwtService.verifyAsync(...)` 都吃这份 options。
 *
 * 守三件事：
 * 1) verifyOptions 里 algorithms 只有 HS256（对称 secret 场景不许按 token header 的 alg 走）；
 * 2) signOptions 里**没有** algorithm —— 签发逻辑一个字没改（默认就是 HS256）；
 * 3) 对照组：同一把 secret 但用 HS512 签发的 token 被拒；不带 verifyOptions 的裸
 *    JwtService 会接受它 —— 证明拒绝来自本文件的 algorithms，而不是 jsonwebtoken 的默认行为。
 */

const ACCESS_SECRET = 'jwt-config-spec-access-secret-0123456789'

function createJwtService() {
  const configService = {
    get: (key: string) =>
      key === 'jwt.access.secret' ? ACCESS_SECRET : key === 'jwt.access.expire' ? 3600 : undefined,
  }

  const options = new JwtConfigClass(configService as never).createJwtOptions()

  return { options, jwtService: new JwtService(options) }
}

describe('jwtConfigClass：验签算法钉死 HS256（F-42）', () => {
  it('verifyOptions.algorithms === [\'HS256\']，且 ignoreExpiration 未被放宽', () => {
    const { options } = createJwtService()

    expect(options.verifyOptions).toEqual({ algorithms: ['HS256'] })
    expect(options.verifyOptions?.ignoreExpiration).toBeUndefined()
  })

  it('signOptions 不含 algorithm（签发逻辑未改，保持库默认 HS256）', () => {
    const { options } = createJwtService()

    expect(options.signOptions).toEqual({ expiresIn: '3600s' })
    expect(options.signOptions?.algorithm).toBeUndefined()
  })

  it('用 HS256 签发的 token 能验过（钉死没有把正常路径弄坏）', async () => {
    const { jwtService } = createJwtService()
    const token = await jwtService.signAsync({ userId: 'spec-user' })

    await expect(jwtService.verifyAsync(token, { ignoreExpiration: false }))
      .resolves
      .toMatchObject({ userId: 'spec-user' })
  })

  it('同一 secret、HS512 签发的 token → 验签失败（算法白名单生效）', async () => {
    const { jwtService } = createJwtService()
    const hs512 = await new JwtService({}).signAsync(
      { userId: 'spec-user' },
      { secret: ACCESS_SECRET, algorithm: 'HS512' },
    )

    await expect(jwtService.verifyAsync(hs512, { secret: ACCESS_SECRET, ignoreExpiration: false }))
      .rejects
      .toThrow(/invalid algorithm/i)
  })

  it('对照：不带 verifyOptions 的裸 JwtService 会接受同一枚 HS512 token（拒绝确来自本文件）', async () => {
    const bare = new JwtService({ secret: ACCESS_SECRET })
    const hs512 = await new JwtService({}).signAsync(
      { userId: 'spec-user' },
      { secret: ACCESS_SECRET, algorithm: 'HS512' },
    )

    await expect(bare.verifyAsync(hs512)).resolves.toMatchObject({ userId: 'spec-user' })
  })
})
