/**
 * risk 矩阵 U11 / U12：IP 维度的两类黑名单。
 *
 * 证伪什么（对齐调研文档「每一层能证伪什么」的口径）：
 * - U11：IP guard 的**永久名单**真源是 `app_setting.app.global.ipBlackList` —— 直接改库后不刷新
 *   缓存不生效、刷新后生效；被拒请求是 40603 且前端跳 `/not-allowed?type=ip`。把 IP 从名单移除
 *   并刷新缓存后同一 context 恢复（否则「被拒」证明不了是名单造成的）。
 * - U12：同一 deviceId + identifier 连续失败 5 次会写 `risk:ip_blacklist:<归一 IP>`（30 分钟 TTL），
 *   第 6 次请求 40603。注意坑：服务端 `SharedIpService.normalizeIp` 把 127/8 统一成 `127.0.0.1`，
 *   所以临时名单键对所有本地客户端是**同一个** —— 用完必须精确删（U12 的 finally），
 *   否则同轮后续用例的 local IP 全被拒。workers=1 保证「建键 → 断言 → 删键」窗口内没有并发用例。
 */
import { randomBytes } from 'node:crypto'
import * as opaque from '@serenity-kit/opaque'
import { loginDevice, trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { readPermanentIpBlacklist, withPg, writePermanentIpBlacklist } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import {
  AppRoutes,
  AuthRoutes,
  SystemEndpointRoutes,
  SystemRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import { ipTempBlacklistKey, riskFailedLoginKey, withRedis } from '../../lib/redis.ts'
import { captureEnvelopes, navigateInApp, waitForEnvelope } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { rootClient } from './risk-support.ts'

/** 本地 IP 归一后的临时名单键（与 `SharedIpService.getTempBlackListRedisKey` 同口径） */
const TEMP_BAN_KEY = ipTempBlacklistKey('127.0.0.1')
/** 服务端 `SharedIpService.ipTempBanTtl`（30 分钟）；TTL 断言的「上限」口径 */
const IP_TEMP_BAN_TTL_SECONDS = 1800

test.describe('IP 黑名单', { tag: '@risk' }, () => {
  test('U11 IP 永久黑名单：写 app_setting 后 40603 → /not-allowed?type=ip，移除即恢复', async ({
    browser,
  }) => {
    const bannedIp = uniqueLocalIp()
    // 名单的读写走 root 权限 + 服务端的缓存刷新端点（与真实写通道同一条缓存失效链路）
    const client = await rootClient()

    const originalList = await withPg((pg) => readPermanentIpBlacklist(pg))
    let restored = false
    const restore = async (): Promise<void> => {
      await withPg((pg) => writePermanentIpBlacklist(pg, originalList))
      await client.root('POST', AppRoutes.SETTING_CACHE_REFRESH)
      restored = true
    }

    // 先让应用完整启动、登录并挂载（设备登记 / 签名握手 / CAP / MFA 都在「未被拒」的状态下完成）；
    // 之后的业务请求由已挂载应用的路由切换触发，跳转链路（router 已就绪）才能被验到。
    const session = await loginDevice(browser, { realIp: bannedIp })

    try {
      // 从这一刻开始采集：黑名单生效后的下一条业务请求就是判据
      const captured = captureEnvelopes(session.page)

      // 永久名单：直接改 app_setting（JSON 数组），再经服务端端点刷新 APP:SETTING 缓存
      await withPg((pg) => writePermanentIpBlacklist(pg, [...originalList, bannedIp]))
      await client.root('POST', AppRoutes.SETTING_CACHE_REFRESH)

      // 状态落点：PG 行里确实有这条 IP（名单真源）
      await withPg(async (pg) => {
        const list = await readPermanentIpBlacklist(pg)
        expect(list, 'app_setting 的永久名单里没有刚写入的 IP').toContain(bannedIp)
      })

      // 已挂载应用里的真实导航（不 reload）：用户页挂载时发列表请求，IP guard 在 controller 之前拒绝它；
      // 前端拦截器把 40603 映射成 type=ip 并 replace 到 /not-allowed。
      await navigateInApp(session.page, SystemRoutes.USER)
      const blocked = await waitForEnvelope(
        captured.entries,
        (entry) => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
        40_000,
      )
      expect(blocked.code, '被拒请求的业务码应是 40603').toBe(
        WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
      )

      // URL 判据：响应拦截器把 40603 映射成 type=ip 并 replace 到 /not-allowed
      await session.page.waitForURL(
        (url) => url.pathname === '/not-allowed' && url.searchParams.get('type') === 'ip',
        { timeout: 30_000 },
      )
      captured.stop()

      // 负对照（闭环）：移除 IP + 刷新缓存后，同一 **context**（同设备 / 同登录态）重新加载不再被拒。
      // 用新页面而不是复用被拒的页面：`captureEnvelopes` 只监听 response，被拒页面在 restore 之前
      // 发出的请求可能到 restore 之后才返回 —— 那会把「旧请求的 40603」记进新采集数组，造成假红
      // （全量跑时出现过 2/3 次；单跑 U11 不复现）。关掉旧页面也顺带取消它的在途请求。
      await restore()
      await session.page.close()
      const recovered = await session.context.newPage()
      const after = captureEnvelopes(recovered)
      await recovered.goto('/')
      await waitForEnvelope(
        after.entries,
        (entry) =>
          entry.url.includes(AuthRoutes.PERMISSIONS) &&
          entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
        40_000,
      )
      expect(
        after.entries.some(
          (entry) => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
        ),
        '名单已移除，重新加载仍收到 40603',
      ).toBe(false)
      expect(new URL(recovered.url()).pathname).not.toBe('/not-allowed')
      after.stop()
    } finally {
      if (!restored) {
        await restore().catch((error: unknown) => {
          // 恢复失败只影响同轮后续用例（名单里是我们的随机 127/8 IP），绝不掩盖断言失败
          console.warn(
            `[e2e] U11 恢复永久名单失败：${error instanceof Error ? error.message : String(error)}`,
          )
        })
      }
      await session.context.close()
    }
  })

  test('U12 失败登录 5 次 → 临时拉黑（risk:ip_blacklist + TTL），第 6 次 40603', async () => {
    await opaque.ready

    const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
    await client.bootstrap()
    trackDevice(client.deviceId)

    // 唯一的失败 identifier：失败计数键是 `risk:failed_login:<identifier>:<deviceId>`，
    // 与设备绑定，清理归 fixture 的 `deleteRiskDeviceState`（按 deviceId 精确删）。
    const identifier = `e2e-ip-ban-${Date.now()}-${randomBytes(3).toString('hex')}`
    const { startLoginRequest } = opaque.client.startLogin({
      password: `not-the-password-${identifier}`,
    })

    try {
      // 前 5 次仍是正常的「凭据无效」响应（40103）—— 拉黑发生在第 5 次失败处理的末尾，
      // 第 5 次请求本身已经过了 IP guard，所以口径是「5 次 40103，之后才 40603」。
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const body = await client.requestFree<{ code: number; msg?: string }>(
          'POST',
          AuthRoutes.OPAQUE_USER_LOGIN_START,
          {
            body: { userName: identifier, start: startLoginRequest },
          },
        )
        expect(
          body.code,
          `第 ${attempt} 次失败登录应回 40103（响应壳 code），实际 ${body.code} ${body.msg ?? ''}`,
        ).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
      }

      // 状态落点 1：失败计数 = 5（同一个 identifier + deviceId）
      // 状态落点 2：临时名单键存在且带 TTL（30 分钟，本地 IP 归一成 127.0.0.1）
      const state = await withRedis(async (redis) => {
        const failedLoginKey = riskFailedLoginKey(identifier, client.deviceId)
        return {
          failedCount: await redis.hGet(failedLoginKey, 'count'),
          failedLoginTtl: await redis.ttl(failedLoginKey),
          banExists: await redis.exists(TEMP_BAN_KEY),
          banTtl: await redis.ttl(TEMP_BAN_KEY),
          banInfo: await redis.hGetAll(TEMP_BAN_KEY),
        }
      })
      expect(state.failedCount, 'failed_login 计数不是 5').toBe('5')
      expect(state.failedLoginTtl, 'failed_login 计数键应有 TTL').toBeGreaterThan(0)
      expect(state.banExists, `临时名单键 ${TEMP_BAN_KEY} 不存在`).toBe(1)
      expect(state.banTtl, `临时名单键的 TTL 应 > 0（实际 ${state.banTtl}）`).toBeGreaterThan(0)
      expect(
        state.banTtl,
        `临时名单键的 TTL 不应超过服务端的 30 分钟（实际 ${state.banTtl}）`,
      ).toBeLessThanOrEqual(IP_TEMP_BAN_TTL_SECONDS)
      expect(state.banInfo.permanent, '临时名单的 permanent 标记应为 0').toBe('0')

      // 第 6 次（同一 IP 的任意受保护路径）被 IP guard 直接拒：40603
      const blocked = await client.rawFetch('GET', SystemEndpointRoutes.USER_ME_PROFILE)
      const blockedBody = (await blocked.json()) as { code: number }
      expect(blockedBody.code, '临时拉黑后的请求应 40603').toBe(
        WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
      )

      // 负对照（闭环）：精确删掉临时名单键后，同一请求不再被 IP guard 拒
      // （没有 Authorization ⇒ 落到后面的 JWT 守卫，不再是 40603）。
      await withRedis((redis) => redis.del(TEMP_BAN_KEY))
      const released = await client.rawFetch('GET', SystemEndpointRoutes.USER_ME_PROFILE)
      const releasedBody = (await released.json()) as { code: number }
      expect(releasedBody.code, '删掉临时名单键后仍被 IP guard 拒').not.toBe(
        WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
      )
    } finally {
      // 窗口内（workers=1）没有并发用例，但失败路径也必须把 127.0.0.1 的临时名单摘掉
      await withRedis((redis) => redis.del(TEMP_BAN_KEY)).catch((error: unknown) => {
        console.warn(
          `[e2e] U12 清理临时 IP 名单失败：${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }
  })
})
