import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutAuthTokens } from '../helpers/api-client'
import type { WalnutRootUserFixture } from '../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { SecurityRiskConfigService } from '@walnut-server/security'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../helpers/auth-login'
import { createApiApp } from '../helpers/create-api-app'
import { signCookieValue } from '../helpers/signed-cookie'

/**
 * CAP guard 的**凭据形态出口（40111）**与两条腿（JWT 前后各挂一次同一个 guard 类）。
 *
 * ── 为什么这份文件必须存在 ───────────────────────────────────────────────────
 * 40111（BotVerifyFailed）在 2026-10-29 之前是**死码**：`throw new YouAreBot()` 写在
 * `performCapVerification` 的 try 里，被同一函数的 catch 吞成 `return false`，客户端
 * 永远只能看到 40116/40117（cap.guard.ts:227-247 的注释记着这笔）。救回来之后，
 * 它一直是**零接口覆盖**：单测（libs/guards 的 cap.guard.spec.ts）盖住了分支，但没有一条
 * 真实 HTTP 链路证明「签名合法 + 内容不是 cap.js token」能走到 40111。
 *
 * 这一条一旦退化（40111 → 40116），前端 `/not-allowed` 流程**永不触发**，且没有任何现有
 * 用例会红 —— 本文件就是防这个静默退化。
 *
 * ── 关键前提：签名必须算对（helpers/signed-cookie.ts）────────────────────────
 * cookie-parser 对「带 s: 前缀但签名错」的值返回 `false`，对「没有 s: 前缀」的值整条丢弃
 * （signedCookies 里连键都没有）。两种都退化到 guard 的「token 缺失」分支 ⇒ 40116/40117。
 * 所以到达**形态校验**的唯一通路是「HMAC 正确的 signed cookie + 不是 cap.js token 的内容」。
 * 见 helpers/signed-cookie.ts 的逐字节复刻说明；负对照 A 就是把这条前提拆掉。
 *
 * ── 两条腿怎么分开断言（重要，别把这条用例读成「只在 JWT 前测了一次」）────────
 * 同一个 `WalnutAdminGuardCap` 类在 app.module.ts 的 APP_GUARD 里挂了两次（#5 pre-auth、
 * #8 post-auth）。它读的东西里有三样与「腿」相关：cookie（两腿相同）、
 * `request.risk.comprehensive.recommendation`（pre-auth 腿读 pre-auth 的评估、post-auth 腿读
 * 合并后的评估）、`request.user`（只有 post-auth 腿有值）。
 *
 * **现状（钉住，不是缺陷）**：凭据形态非法时，pre-auth 腿必然先拒 —— 两腿读同一枚 cookie，
 * 后挂的那一挂不可能比先挂的先看到它。所以 40111 在两条腿上的**响应码完全相同**，
 * 靠 body.code 无法区分是谁拒的。能区分腿的是**成功路径上的 handled 标记维度**：
 * - pre-auth 腿的 critical factor 是 `DEVICE_NEW`（stage=pre-auth）⇒ 标记落在
 *   `risk:challenge:device:<deviceId>:DEVICE_NEW`（只有 deviceId，没有 userId）；
 * - post-auth 腿的 critical factor 是 `USER_DEVICE_UNTRUSTED`（stage=post-auth）⇒ 标记落在
 *   `risk:challenge:user-device:<userId>:<deviceId>:USER_DEVICE_UNTRUSTED` ——
 *   `generateRecommendation` 在 post-auth 阶段且 `userId` 缺失时直接返回空
 *   （risk.service.ts:263-266），所以**这个键只有 post-auth 腿能写出来**。
 * 两个键就是「两条腿都真的执行了」的可观测证据，比在同一个 40111 上写两遍更有信息量。
 *
 * ── 消息面不能当判据 ────────────────────────────────────────────────────────
 * 40111/40116/40117 的 msg 走 i18n，断言只用 `body.code` 精确值 + Redis 副作用。
 */

describe('CAP guard：40111 形态校验 / 两条腿 / DEVICE_NEW handled 标记', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  let redis: ReturnType<AppTechRedisService['getClient']>
  let cookieSecret: string

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let tokens: WalnutAuthTokens | null = null

  const CAP = WalnutAdminConstCookieKeys.CAPJS_TOKEN

  /** 「让 CAP 走真验」的端点：CAP-active、DeviceFree、匿名可达（root 的 GET /） */
  const capActiveAnonymous = () => api.apiPath('/')
  /** 已登录态的 CAP-active 端点（非 CapFree / 非 SignFree，与 guard-matrix 同款） */
  const capActiveAuthed = () => api.apiPath('/system/user/lock/read')

  /** 用真实 secret 签一枚**签名合法**的 cookie 值（helpers/signed-cookie.ts 的逐字节复刻） */
  function forgeCapCookie(value: string): void {
    api.setCookie(CAP, signCookieValue(cookieSecret, value))
  }

  /**
   * challenge 键的落点（challenge.service.ts:142-161）：
   * `<risk:challenge>:<scope>:<值...>:<factor>`，scope 由 factor 前缀决定
   * （DEVICE_ → device / USER_DEVICE_ → user-device）。键**不带** `WALNUT_CACHE_` 前缀 ——
   * challenge 服务直连 `AppTechRedisService.getClient()`，与 `AppTechCacheService` 不是同一层。
   */
  function challengeKey(scope: 'device' | 'user-device', parts: string[], factor: string): string {
    const prefix = app.get(SecurityRiskConfigService).redis.challenge
    return `${prefix}:${scope}:${[...parts, factor].join(':')}`
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    redis = app.get(AppTechRedisService).getClient()
    cookieSecret = app.get(ConfigService).get<string>('app.cookie.secret')!
  })

  afterAll(async () => {
    if (api !== undefined) {
      const pg = api.pgDataSource

      if (fixture !== null) {
        // 顺序按外键：lock / device 关系 → RT → 角色 junction → user → role
        for (const sql of [
          'DELETE FROM sys_user_lock WHERE user_id = $1',
          'DELETE FROM sys_user_device WHERE user_id = $1',
          'DELETE FROM auth_refresh_token WHERE user_id = $1',
          'DELETE FROM sys_user_role WHERE user_id = $1',
          'DELETE FROM sys_user WHERE id = $1',
        ]) {
          await pg.query(sql, [fixture.userId]).catch(() => undefined)
        }
        await pg.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId]).catch(() => undefined)
        await api.cleanupWalnutCacheKeys(fixture.userId)
      }

      await pg.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId]).catch(() => undefined)
      await api.cleanupWalnutCacheKeys(api.deviceId)

      // 本文件唯一写过的 Redis 副作用：两个 challenge 标记 + 风控评估缓存
      await redis.del([
        challengeKey('device', [api.deviceId], 'DEVICE_NEW'),
        challengeKey('user-device', [fixture?.userId ?? '', api.deviceId], 'USER_DEVICE_UNTRUSTED'),
        `${app.get(SecurityRiskConfigService).redis.deviceInfo}:${api.deviceId}`,
      ])
    }

    await app?.close()
  })

  // ============================================================
  // 40111：签名合法 + 不是 cap.js token 形态
  // ============================================================
  describe('40111：cookie 签名合法、内容不是 cap.js token（零接口覆盖的那条分支）', () => {
    it('匿名 CAP-active 请求 + 签名合法的非 cap.js 值 ⇒ 40111（不是 40116）', async () => {
      const saved = api.getCookie(CAP)!
      forgeCapCookie(`cap-shape-probe-${seed8}`)
      try {
        const res: SuperTestResponse = await api.unsigned('GET', capActiveAnonymous())

        // 形态非法在**本地**即可判定（不打 cap.js、不看 shouldChallenge），所以两种
        // recommendation 下都必须是 40111 —— 这也是它与 40116/40117 的语义分界。
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED)
        // 负对照 1（同一个输入，只换断言）：退化实现会给出 40116，前端 /not-allowed 永不触发
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED)
      }
      finally {
        api.setCookie(CAP, saved)
      }
    })

    it('负对照 A：同一枚垃圾值**不签名** ⇒ cookie-parser 整条丢弃 ⇒ 40116（缺失语义），40111 不可达', async () => {
      const saved = api.getCookie(CAP)!
      // 没有 s: 前缀 → signedCookies 里连键都不会有 → guard 走「token 缺失」
      api.setCookie(CAP, `cap-shape-probe-${seed8}`)
      try {
        const res = await api.unsigned('GET', capActiveAnonymous())

        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED)
      }
      finally {
        api.setCookie(CAP, saved)
      }
    })

    it('负对照 B：形态合法（<hex>:<hex>）但 cap.js 不认 ⇒ 40116（形态闸放行；40111 只认「不是 cap.js token」）', async () => {
      const saved = api.getCookie(CAP)!
      // 与 cap.js 真实 token 同形（redeemChallenge 的 `${randomHex(8)}:${randomHex(15)}`），
      // 但 store 里没有 ⇒ validateToken → success:false ⇒ 可自愈的 40116
      forgeCapCookie('deadbeefdeadbeef:cafebabecafebabe')
      try {
        const res = await api.unsigned('GET', capActiveAnonymous())

        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED)
      }
      finally {
        api.setCookie(CAP, saved)
      }
    })
  })

  // ============================================================
  // pre-auth 腿的成功路径：markHandled(DEVICE_NEW) 落在 device 维度
  // ============================================================
  describe('pre-auth 腿：markHandled(DEVICE_NEW) 的可观测落点', () => {
    it('CAP-active 请求首次通过 ⇒ Redis 落 risk:challenge:device:<deviceId>:DEVICE_NEW（24h）', async () => {
      const key = challengeKey('device', [api.deviceId], 'DEVICE_NEW')

      // 前置：本文件此前所有 CAP-active 请求都被 40111/40116 拒在「验证成功之前」，
      // 标记不可能已经写过（这也顺带证明它不是被引导期顺手写下的）
      await redis.del(key)
      expect(await redis.exists(key)).toBe(0)

      // 引导期 redeem 的 cap.js token 此时仍是**未消费**的那一枚（此前都在形态闸被拒），
      // 这一发走真验 → 通过 → 写验证缓存 + markCriticalFactorsAsHandled
      const res = await api.anon('GET', capActiveAnonymous())
      expectOk(res, 'CAP-active anonymous request')

      expect(await redis.exists(key)).toBe(1)
      const payload = JSON.parse(await redis.get(key) ?? 'null') as { factor?: string, handledAt?: number }
      expect(payload.factor).toBe('DEVICE_NEW')
      expect(typeof payload.handledAt).toBe('number')

      // 边界关系而非墙钟：TTL 落在 (0, config.ttl.challenge] 内
      const ttl = await redis.ttl(key)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(app.get(SecurityRiskConfigService).ttl.challenge)
    })

    it('标记落点只随「CAP 验证通过」出现：清掉标记后再请求，DEVICE_NEW 重新变回未处理 → 策略降级面 40117', async () => {
      const key = challengeKey('device', [api.deviceId], 'DEVICE_NEW')
      const saved = api.getCookie(CAP)!

      // 标记在 ⇒ 缺 CAP 凭据只是 40117（策略降级，可无感刷新）
      api.dropCookie(CAP)
      try {
        const degraded = await api.unsigned('GET', capActiveAnonymous())
        expect(bodyOf(degraded).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED)
      }
      finally {
        api.setCookie(CAP, saved)
      }

      // 标记被清 ⇒ 同一请求变成「需要交互」的 40116 —— 同一输入、只差这一个 Redis 键
      await redis.del(key)
      api.dropCookie(CAP)
      try {
        const challenged = await api.unsigned('GET', capActiveAnonymous())
        expect(bodyOf(challenged).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
      }
      finally {
        api.setCookie(CAP, saved)
      }
    })
  })

  // ============================================================
  // post-auth 腿（JWT 之后的那一挂）
  // ============================================================
  describe('post-auth 腿：认证态不放宽凭据形态 + 只有它能写的 user-device handled 标记', () => {
    beforeAll(async () => {
      fixture = await registerRootUserFixture(app, api.pgDataSource, `capg-${seed8}`)
      tokens = await performHttpOpaqueLogin(api, app, fixture)
      api.setAuth(tokens)
      await api.seedMfaVerifiedCache(fixture.userId)
    })

    it('放行基线：登录后 CAP-active 请求 20000（CAP 走验证缓存命中，两条腿都放行）', async () => {
      const res = await api.root('GET', capActiveAuthed())
      expectOk(res, 'authenticated baseline')
    })

    it('post-auth 腿独立执行 ⇒ USER_DEVICE_UNTRUSTED 的标记落在 user-device 维度（含 userId，pre-auth 腿写不出这个键）', async () => {
      const key = challengeKey('user-device', [fixture!.userId, api.deviceId], 'USER_DEVICE_UNTRUSTED')

      await redis.del(key)
      expect(await redis.exists(key)).toBe(0)

      const res = await api.root('GET', capActiveAuthed())
      expectOk(res, 'authenticated CAP-active request')

      expect(await redis.exists(key)).toBe(1)
      const payload = JSON.parse(await redis.get(key) ?? 'null') as { factor?: string }
      expect(payload.factor).toBe('USER_DEVICE_UNTRUSTED')
    })

    it('已登录 + 签名合法的非 cap.js 值 ⇒ 仍是 40111（会话有效不等于凭据形态合法）', async () => {
      const saved = api.getCookie(CAP)!
      forgeCapCookie(`cap-shape-probe-auth-${seed8}`)
      try {
        const res = await api.root('GET', capActiveAuthed())

        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED)
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
        // 佐证「CAP 在 JWT 之前就拒了」：不是 JWT 层错误（否则会话有效时不该出现）
        expect(bodyOf(res).code).not.toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        api.setCookie(CAP, saved)
      }
    })

    it('还原后同一客户端再请求 20000（伪造只影响那一发，没有污染设备/会话状态）', async () => {
      const res = await api.root('GET', capActiveAuthed())
      expectOk(res, 'restored after forged cap cookie')
    })
  })
})
