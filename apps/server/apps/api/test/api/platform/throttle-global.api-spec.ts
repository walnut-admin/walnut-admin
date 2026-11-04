import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import { ConfigService } from '@nestjs/config'
import { AppTechRedisService } from '@walnut-server/cache'
import { SharedIpService } from '@walnut-server/ip'
import { SecurityRiskConfigService, WalnutAdminConstRiskLevel } from '@walnut-server/security'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, WalnutApiClient } from '../helpers/api-client'
import { createApiApp } from '../helpers/create-api-app'

/**
 * **全局限流桶**（`app.throttle.ttl` / `app.throttle.limit`，throttler.service.ts:39-45）。
 *
 * 现有两份 throttle spec 覆盖的都是**装饰器动态桶**：
 * - throttle.api-spec.ts → `system/device/initial`（SysDeviceSettingService，4/60s）
 * - cap-throttle.api-spec.ts → `security/cap/*`（SecurityCapSettingService，4/60s）
 *
 * 没有装饰器的普通端点走**全局默认桶**，这条一直是零覆盖 —— 而它才是全站兜底：动态桶
 * 只挂在少数端点上，其余端点（含所有未显式标注的读写接口）只有这一层。本文件钉住它。
 *
 * ── 判据怎么不给墙钟 ────────────────────────────────────────────────────────
 * - 「打满」用**计数**：limit 次连发全部 20000、第 limit+1 次 42900；
 * - 「Retry-After 合理」用**边界关系**：1 ≤ Retry-After ≤ 配置的 ttl 秒数
 *   （throttler.service.ts 把 ttl 秒 ×1000 交给守卫，blockDuration 缺省 = ttl），
 *   不是「≈ 配置值 ± 容差」，也不是 `Date.now()` 差值。
 * - 「桶身份」用 `X-RateLimit-Remaining`（@nestjs/throttler 在放行响应上回填的
 *   `limit - totalHits`）—— 它比「再打满一次看会不会 42900」便宜 120 倍，且完全确定：
 *   同一个桶连发剩余量递减、换桶剩余量回到 limit-1。
 *
 * ── XFF 换 IP 即换桶：结论是**现状**，不是本轮引入的缺陷 ────────────────────
 * tracker 是 `req.realIp`，而 realIp 来自 `@supercharge/request-ip`（**header 优先**、
 * 不校验跳数，也不看 express 的 trust proxy）—— 见 ip.middleware.ts 的头注释
 * （F-11 / SEC-007 / CQ-006）。即：**应用侧的限流维度完全信任边缘代理覆写 X-Forwarded-For**。
 * 生产 nginx 用 `$remote_addr` 覆写（deploy/nginx/conf.d/api.conf 的 proxy_set_header），
 * 对外这条通道不可被客户端改写；但只要有人改成 `$proxy_add_x_forwarded_for`、或让端口
 * 直连暴露，限流 + IP 黑名单 + 风控就会被一个请求头整体绕过/嫁祸。这是**部署契约的已知
 * 风险面**（源码注释里已登记），不是代码缺陷 —— 所以本文件钉现状，不动业务代码。
 *
 * ── 存储是进程内内存（throttler.service.ts:8-29）──────────────────────────
 * 计数器随 app 实例生灭，所以本文件的连发**不会**影响其它 spec 的桶；反过来，本文件
 * 的 `limit` 从 ConfigService 现读（开发环境 120/10s，stage/prod 是 120/60s），
 * 不写死数字。
 */

describe('全局限流桶（无装饰器端点）+ XFF 是否换桶', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  let redis: ReturnType<AppTechRedisService['getClient']>

  let limit = 0
  let ttlSeconds = 0

  /** 无装饰器的普通端点：LockFree + SignFree + JwtFree + CapFree + DeviceFree ⇒ 只吃全局限流 */
  const PROBE_ROUTE = '/system/lang/list/public'
  /** TEST-NET-3（RFC 5737 文档专用段）：伪造 XFF 不会路由到任何真实主机 */
  const PROBE_IP_A = '203.0.113.61'
  const PROBE_IP_B = '203.0.113.62'

  /** 连发批量（并发压窗：整轮必须在同一个 ttl 窗口内打完） */
  const BURST_BATCH = 20

  async function probe(xff?: string): Promise<SuperTestResponse> {
    return api.unsigned(
      'GET',
      api.apiPath(PROBE_ROUTE),
      undefined,
      xff === undefined ? undefined : { 'x-forwarded-for': xff },
    )
  }

  /** `X-RateLimit-Remaining` = limit - totalHits（桶内累计命中数） */
  function remainingOf(res: SuperTestResponse): number {
    return Number(res.headers['x-ratelimit-remaining'])
  }

  /**
   * 预写 location 风控缓存（SECURITY_RISK：location 评估会外连 api.ip.sb，对 TEST-NET-3
   * 保留段返回 400 → 50302）。与 guard-matrix.api-spec.ts 同款手法：写进它的**真实缓存
   * 通道**（`risk:location:<normalizedIp>`，不是 CACHE_MANAGER），命中即不外连。
   */
  async function seedLocationRiskCache(ip: string): Promise<void> {
    const normalizedIp = await app.get(SharedIpService).normalizeIp(ip)
    const key = `${app.get(SecurityRiskConfigService).redis.location}:${normalizedIp}`
    const payload: IWalnutAdminLocationRiskInfo = {
      ip,
      location: { ip, country: 'LOCAL', region: 'LOCAL', city: 'LOCAL' },
      score: 0,
      factors: [],
      level: WalnutAdminConstRiskLevel.LOW,
      evaluatedAt: Date.now(),
    }
    await redis.setEx(key, app.get(SecurityRiskConfigService).ttl.location, JSON.stringify(payload))
  }

  beforeAll(async () => {
    app = await createApiApp()

    const configService = app.get(ConfigService)
    limit = Number(configService.get<number>('app.throttle.limit'))
    ttlSeconds = Number(configService.get<number>('app.throttle.ttl'))
    // 配置读不到就无法做边界断言 —— 直接失败而不是「跳过」
    expect(Number.isFinite(limit) && limit > 0).toBe(true)
    expect(Number.isFinite(ttlSeconds) && ttlSeconds > 0).toBe(true)

    api = await WalnutApiClient.create(app)
    redis = app.get(AppTechRedisService).getClient()

    await seedLocationRiskCache(PROBE_IP_A)
    await seedLocationRiskCache(PROBE_IP_B)
  })

  afterAll(async () => {
    if (api !== undefined) {
      await api.pgDataSource
        .query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
        .catch(() => undefined)
      await api.cleanupWalnutCacheKeys(api.deviceId)

      // 风控侧副作用清干净（rate 计数会跨 spec 累积：120 次连发足以把 127.0.0.1 推到
      // RATE_LIMIT_EXCEEDED 阈值，进而改变相邻 spec 的 shouldChallenge 读数）
      const redisService = app.get(AppTechRedisService)
      const riskConfig = app.get(SecurityRiskConfigService)
      await redisService.delByPattern(`${riskConfig.redis.ratePrefix}:*`).catch(() => undefined)
      await redis.del([
        `${riskConfig.redis.deviceInfo}:${api.deviceId}`,
      ])
      for (const ip of [PROBE_IP_A, PROBE_IP_B]) {
        const normalizedIp = await app.get(SharedIpService).normalizeIp(ip)
        await redis.del(`${riskConfig.redis.location}:${normalizedIp}`)
      }
    }

    await app?.close()
  })

  // ============================================================
  // 1. 全局桶真的存在，并在 limit+1 处拒绝
  // ============================================================
  describe(`全局桶：${PROBE_ROUTE} 走 app.throttle.*（无装饰器）`, () => {
    it('同一 tracker 连发 limit 次（app.throttle.limit）全部放行，没有更早的拒绝面', async () => {
      const codes: number[] = []

      for (let sent = 0; sent < limit; sent += BURST_BATCH) {
        const size = Math.min(BURST_BATCH, limit - sent)
        const responses = await Promise.all(Array.from({ length: size }, async () => probe()))
        codes.push(...responses.map(res => bodyOf(res).code))
      }

      expect(codes).toHaveLength(limit)
      // 全部 20000：limit 是「阈值」不是「建议值」，第 limit 发必须还在
      expect(codes.filter(code => code === WalnutAdminConstAppResponseCode.SUCCESS)).toHaveLength(limit)
      expect(codes).not.toContain(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)
    })

    it('第 limit+1 发 → 42900（HTTP 200 壳）+ Retry-After ∈ [1, ttl 秒]（边界关系，不是墙钟）', async () => {
      const blocked = await probe()

      // 全局异常过滤器把 ThrottlerException 映射成「HTTP 200 + body.code 42900」（钉现状）
      expect(blocked.status).toBe(200)
      expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)

      // 边界关系而非墙钟：Retry-After 是 storage 回的「封禁窗口还剩几秒」，
      // 缺省 blockDuration = ttl（throttler.service.ts:41 的 ttl 秒 ×1000）
      const retryAfter = Number(blocked.headers['retry-after'])
      expect(Number.isFinite(retryAfter)).toBe(true)
      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(retryAfter).toBeLessThanOrEqual(ttlSeconds)

      // 封禁窗口内再来一发仍是 42900（不是「这一发过了就恢复」）
      const again = await probe()
      expect(bodyOf(again).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)
    })
  })

  // ============================================================
  // 2. 桶身份 = (route, tracker)，tracker = req.realIp = X-Forwarded-For 派生
  // ============================================================
  describe('桶身份：换 X-Forwarded-For 是否换桶（throttler.guard.ts:34-36 getTracker = req.realIp）', () => {
    it('默认 tracker 仍处封禁窗口（对照组：换 IP 之后它会变成唯一被封的那个）', async () => {
      const res = await probe()
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)
    })

    it('换 XFF ⇒ 换桶（新 tracker 从 limit-1 重新计数）；同 XFF 继续同一桶（递减）', async () => {
      // A 的桶是全新的：第一发剩余量必须是 limit-1（而不是接着默认 tracker 的计数）
      const a1 = await probe(PROBE_IP_A)
      expect(bodyOf(a1).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(remainingOf(a1)).toBe(limit - 1)

      const a2 = await probe(PROBE_IP_A)
      expect(remainingOf(a2)).toBe(limit - 2)

      // B 与 A 只差一个请求头：计数必须回到 limit-1 ⇒ 桶身份含 tracker
      const b1 = await probe(PROBE_IP_B)
      expect(bodyOf(b1).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(remainingOf(b1)).toBe(limit - 1)

      // 回到 A：仍然是 A 的桶（limit-3），没有被 B 的请求影响
      const a3 = await probe(PROBE_IP_A)
      expect(remainingOf(a3)).toBe(limit - 3)
    })

    it('伪造 XFF 不改变其它状态：A 打满后 B 仍然放行（封禁按桶隔离）', async () => {
      // 把 A 的桶打满（先补到 limit 次，再发一发越线）
      const used = 3 // a1/a2/a3
      const rest = limit - used

      for (let sent = 0; sent < rest; sent += BURST_BATCH) {
        const size = Math.min(BURST_BATCH, rest - sent)
        await Promise.all(Array.from({ length: size }, async () => probe(PROBE_IP_A)))
      }

      const blockedA = await probe(PROBE_IP_A)
      expect(bodyOf(blockedA).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)

      // B 的桶只用了 1 次，不受 A 的封禁影响
      const stillOkB = await probe(PROBE_IP_B)
      expect(bodyOf(stillOkB).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    })
  })
})
