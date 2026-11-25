/**
 * 设备 ID 全生命周期（本批重点）。
 *
 * 已核实的机制（写用例时以此为准，别再假设 XFF 决定设备身份）：
 * - 设备身份 = 服务端签发的 **signed cookie**：`POST /system/device/initial` 是唯一签发点
 *   （`d1_` + 32 hex）；全新 context（无 cookie）天然就是一台新设备；
 * - `X-Forwarded-For` 只决定 `req.realIp`（黑名单 / throttle / 失败登录 / 定位），
 *   不参与设备身份；
 * - 40605 自愈：cookie 丢了但 `localStorage.GEO_IP_DEVICE_ID` 还在（或行被删）⇒ 前端重打
 *   initial 并重放原请求；
 * - 滑动续期：Redis 的 `SYSTEM:DEVICE:COOKIE_RENEW:<id>` 键决定「这次要不要重发 cookie」；
 * - 封禁 / 锁定：root 调 `PATCH /system/device/:id/{ban,lock}` ⇒ victim 下一次请求
 *   40607 / 40606 ⇒ 前端跳 `/not-allowed?type=deviceBanned|deviceLocked`；
 * - 新设备 / 最近设备：`sys_device.created_at` 回填后重登，DEVICE_NEW（<1 天）/
 *   DEVICE_RECENT（<7 天）作为 critical 因子触发 CAP 交互。
 *
 * 注意：自愈（cookie 丢失）本身会签发**全新设备**，新设备的 DEVICE_NEW 也是 critical 因子 ——
 * 所以 U8/U9 在自愈后必须先解掉 CAP（重放先吃 40116）。旧会话按设备绑定（`AUTH:SESSIONS`
 * 会话键与 RT 行都带 deviceId），换设备后重放最终 40101、续期 40102，应用 Signout 回 /auth；
 * 把 40116 当成「重放成功」会掩盖真实结果（旧判据 `code !== 40605` 就栽在这里）。
 *
 * 每条用例自造设备；清理**不写在用例末尾**（断言失败就跳过）—— 设备在签发时登记给
 * `tests/fixtures.ts` 的 auto fixture，由它在用例结束时按 deviceId 删 PG 行与 Redis 键
 * （**不 FLUSHDB**）。
 *
 * 标记：依赖真实外网的用例在标题里带 `@network`，由独立的 network project 跑（risk 用
 * `grepInvert` 排除它们）—— 离线环境里 risk 仍应全绿。两条「回填 created_at」用例现在是
 * **协议预置设备 + 一次 UI 登录**（P0-3），标了 `test.slow()`；U8/U9 **刻意不标** —— 修好后的
 * flake 应在 120s 内红，拖到 360s 只会掩盖问题。
 */
import {
  loginDevice,
  newBrowserContext,
  openDevice,
  resolveDeviceId,
  trackDevice,
  uniqueLocalIp,
} from '../../lib/device-fixtures.ts'
import { backdateDeviceCreatedAt, clearRefreshTokensForDevice, findDeviceLocation, findDeviceRow, LOOPBACK_IP_PATTERN, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { AuthRoutes, SystemEndpointRoutes, SystemRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import {
  deleteAuthSessionsForDevice,
  deleteDeviceKeys,
  deviceCookieRenewKey,
  readRiskDevice,
  riskChallengeKeyPattern,
  riskDeviceKey,
  scanKeys,
  withRedis,
} from '../../lib/redis.ts'
import {
  captureEnvelopes,
  loginViaUI,
  navigateInApp,
  readDeviceCookie,
  readLocalDeviceId,
  waitForDeviceHealSettled,
  waitForEnvelope,
} from '../../lib/ui.ts'
import {
  DEVICE_COOKIE_NAME,
  readCredentials,
  WEB_ORIGIN,
} from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 建一个已登录的 root 协议客户端（自带设备 + TOTP 设备验证）；设备随即登记给清理 fixture */
async function rootClient(): Promise<{ client: WalnutProtocolClient, deviceId: string }> {
  const credentials = readCredentials()
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  trackDevice(client.deviceId)
  await client.login(credentials.userName, credentials.password)
  await client.verifyTotpForDevice(credentials.totpSecret)
  return { client, deviceId: client.deviceId }
}

async function deviceRowUuid(deviceId: string): Promise<string> {
  return withPg(async (pg) => {
    const row = await findDeviceRow(pg, deviceId)
    if (row === null) {
      throw new Error(`[e2e] sys_device 没有 ${deviceId} 的行`)
    }
    return row.id
  })
}

interface SeededDevice {
  deviceId: string
  realIp: string
  /** 服务端签发的 DEVICE_ID cookie 值（Set-Cookie 原样，含 `s%3A` 编码） */
  cookie: string
}

/**
 * 用协议客户端预置一台**已登录过**的设备，并把 `created_at` 回填到 N 毫秒前。
 *
 * 目的是把 DEVICE_NEW / DEVICE_RECENT 用例从「两次 UI 登录」降到「一次 UI 登录」：
 * 第一次登录走协议（设备登记 → CAP → 签名握手 → OPAQUE → TOTP），拿到服务端签发的
 * `DEVICE_ID` cookie；回填与风控缓存清理之后，浏览器只需要注入该 cookie 再走一次 UI 登录
 * 就能触发目标状态（DEVICE_NEW / DEVICE_RECENT 的 CAP）。
 *
 * 几个必须做对的点：
 * - **清 RT / 会话**：协议登录会留下 active RT 与 `AUTH:SESSIONS` 键，同设备同用户的 UI 登录
 *   会在 login/finish 撞 40109「重复认证」。清理口径与原 `reloginOnSameDevice` 的「登出」一半
 *   相同（P0-3 后那个 helper 已随「两次 UI 登录」一起删除）；
 * - **回填放在协议登录之后**：登录时设备仍是刚创建的真实顺序，回填只服务于下一次登录的风险判定；
 * - **清风控缓存与挑战标记**：协议登录已经评估过 DEVICE_NEW 并把它标成 handled；不清掉，
 *   UI 登录不会重新弹 CAP（这正是要验的东西）。
 */
async function seedLoggedInDevice(msAgo: number): Promise<SeededDevice> {
  const credentials = readCredentials()
  const realIp = uniqueLocalIp()
  const client = new WalnutProtocolClient({ realIp })
  await client.bootstrap()
  // 立刻登记：后面的断言失败时，清理 fixture 仍要能找到这台设备
  trackDevice(client.deviceId)
  const deviceId = client.deviceId

  await client.login(credentials.userName, credentials.password)
  await client.verifyTotpForDevice(credentials.totpSecret)

  // 协议登录的「登出」：删 active RT 与会话键，避免 UI 登录撞 40109
  await withPg(async (pg) => {
    await clearRefreshTokensForDevice(pg, deviceId)
  })
  await withRedis(async (redis) => {
    await deleteAuthSessionsForDevice(redis, deviceId)
  })

  await withPg(async (pg) => {
    await backdateDeviceCreatedAt(pg, deviceId, msAgo)
  })
  await withRedis(async (redis) => {
    await redis.del(riskDeviceKey(deviceId))
    const keys = await scanKeys(redis, riskChallengeKeyPattern(deviceId))
    if (keys.length > 0) {
      await redis.del(keys)
    }
  })

  const cookie = client.getCookie(DEVICE_COOKIE_NAME)
  if (cookie === undefined) {
    throw new Error('[e2e] 协议客户端没有拿到服务端签发的 DEVICE_ID cookie')
  }
  return { deviceId, realIp, cookie }
}

/**
 * 打开一台「沿用预置设备身份」的浏览器 context：把协议客户端拿到的 DEVICE_ID 注入进去。
 *
 * stage 形态的 cookie 无前缀；`Secure` 在 http://127.0.0.1 上可用是本仓已实测的结论
 * （auth.setup 的 gate 3 每轮守它）。localStorage 故意不预置：应用启动时会用 cookie 里的 id
 * 重打 `device/initial`（服务端按 cookie 幂等复用同一台设备），行为与「全新 context」一致。
 */
async function contextOnSeededDevice(browser: import('@playwright/test').Browser, seeded: SeededDevice): Promise<import('@playwright/test').BrowserContext> {
  const context = await newBrowserContext(browser, { realIp: seeded.realIp })
  await context.addCookies([{
    name: DEVICE_COOKIE_NAME,
    value: seeded.cookie,
    url: WEB_ORIGIN,
    secure: true,
    httpOnly: true,
  }])
  return context
}

test.describe('设备 ID 生命周期', () => {
  test('U1 新设备签发：initial → d1_+32hex、DEVICE_ID cookie、sys_device 行', async ({ browser }) => {
    const context = await newBrowserContext(browser)
    const page = await context.newPage()
    const pending = page.waitForResponse(
      response => response.url().includes(SystemEndpointRoutes.DEVICE_INITIAL) && response.request().method() === 'POST',
      { timeout: 30_000 },
    )

    await page.goto('/auth')
    const initialResponse = await pending
    const body = await initialResponse.json() as { code: number, data: { deviceId: string } }
    trackDevice(body.data.deviceId)

    expect(body.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    expect(body.data.deviceId).toMatch(/^d1_[0-9a-f]{32}$/)

    // cookie：stage 形态无前缀（不是 __Host-/__Secure-），值带 `s:` 签名
    const cookie = await readDeviceCookie(context)
    expect(cookie, 'DEVICE_ID cookie 没落盘').not.toBeNull()
    const cookieDeviceId = decodeURIComponent(cookie!.value).startsWith('s:')
      ? decodeURIComponent(cookie!.value).slice(2).split('.')[0]
      : decodeURIComponent(cookie!.value).split('.')[0]
    expect(cookieDeviceId).toBe(body.data.deviceId)

    // localStorage 同源（存储层 100ms 防抖 + 500ms maxWait，用 poll 等它落盘）
    await expect.poll(() => readLocalDeviceId(page), { timeout: 10_000 }).toBe(body.data.deviceId)

    // 库里有一行，且是本地 IP（127.0.0.x 不走外网定位）
    await withPg(async (pg) => {
      const row = await findDeviceRow(pg, body.data.deviceId)
      expect(row).not.toBeNull()
      expect(row!.ip).toMatch(LOOPBACK_IP_PATTERN)
      expect(row!.active).toBe(true)
    })

    await context.close()
  })

  test('U1b Phase0-5 @network：非 local IP 的 initial 走真实定位（api.ip.sb）', async () => {
    const client = new WalnutProtocolClient({ realIp: '1.1.1.1' })
    await client.bootstrap()
    trackDevice(client.deviceId)

    const details = await withPg(async pg => findDeviceLocation(pg, client.deviceId))

    expect(details?.ip).toBe('1.1.1.1')
    // 真实外网定位：country 不应是 LOCAL，经纬度应被写入
    expect(details?.country, '非 local IP 走了 getLocalLocation（定位链路没被调用）').not.toBe('LOCAL')
    expect(typeof details?.country).toBe('string')
    expect(typeof details?.latitude).toBe('number')
    expect(typeof details?.longitude).toBe('number')
  })

  test('Phase0-4 静态代理保留 XFF：经 /api 带 XFF 的设备登记，realIp 被后端采用', async ({ browser }) => {
    // 用**公网** XFF 而不是 127.0.0.5：风控的 rate 键会把 local IP 归一成 127.0.0.1
    // （sharedIpService.normalizeIp），本机 IP 无法区分「代理保留了头」与「没保留」。
    // 1.1.1.1 是公网可路由地址（Cloudflare DNS）。这条**不断言定位结果**：外网 geoip 的连通性
    // 由 @network 的 U1b 负责，本机离线时这条仍应成立（只查库与缓存）。
    const context = await browser.newContext()
    const response = await context.request.post(`${WEB_ORIGIN}/api${SystemEndpointRoutes.DEVICE_INITIAL}`, {
      headers: { 'x-forwarded-for': '1.1.1.1' },
      data: { deviceInfo: {}, hardwareInfo: {}, sr: { height: 800, width: 1280 }, vp: { height: 800, width: 1280 }, private: false },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json() as { code: number, data: { deviceId: string } }
    expect(body.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    trackDevice(body.data.deviceId)

    // 证据 1：设备行 ip = XFF 指定的地址（代理没有把它改写成 127.0.0.1）
    await withPg(async (pg) => {
      const row = await findDeviceRow(pg, body.data.deviceId)
      expect(row?.ip, 'XFF 在静态代理处丢了（后端的 realIp 退化成 127.0.0.1）').toBe('1.1.1.1')
    })

    // 证据 2：风控的 rate 记账也按真实 IP（Redis 键 risk:rate:ip:<ip>:<分钟>）
    await withRedis(async (redis) => {
      const keys = await scanKeys(redis, 'risk:rate:ip:1.1.1.1:*')
      expect(keys.length, '风控 rate 没有按 XFF 的 IP 记账（键 risk:rate:ip:1.1.1.1:*）').toBeGreaterThan(0)
    })

    await context.close()
  })

  test('U8 40605 自愈：cookie 丢、localStorage 在 → initial + 重放，不跳 /not-allowed', async ({ browser }) => {
    const session = await loginDevice(browser)
    const oldDeviceId = session.deviceId

    // 只删 cookie，保住 localStorage（这正是 P0-1 自愈链路的触发条件）
    await session.context.clearCookies({ name: DEVICE_COOKIE_NAME })

    const captured = captureEnvelopes(session.page)
    // 不 reload：丢 cookie 后整页重载会先卡在 blocking 的 sign 步骤（security/sign/* 是
    // 风控 fail-close，缺 deviceId 直接 40667，应用进错误屏）——自愈跑在**已挂载**的请求上。
    await navigateInApp(session.page, SystemRoutes.USER)

    // 先出现 40605（DeviceGuard 拒绝）
    const rejected = await waitForEnvelope(captured.entries, entry => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED, 40_000)

    // 自动重打 initial（出现 40605 之后）
    const initialIndex = captured.entries.findIndex(entry => entry === rejected)
    const healed = await waitForEnvelope(
      captured.entries,
      entry => entry.url.includes(SystemEndpointRoutes.DEVICE_INITIAL) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
      30_000,
    )
    expect(captured.entries.indexOf(healed)).toBeGreaterThan(initialIndex)

    // 原请求被重放：新设备先吃 40116（DEVICE_NEW critical）⇒ 必须解 CAP；解掉后旧会话按
    // 设备绑定失效（重放最终 40101、续期 40102），应用 Signout 回 /auth。旧判据
    // `code !== 40605` 会把 40116 误判成成功。
    const { capSolved } = await waitForDeviceHealSettled(session.page, captured.entries, rejected.url)
    expect(capSolved, '自愈产生的新设备应触发 CAP（DEVICE_NEW critical）——若未弹 cap-widget，检查 risk 配置是否被改').toBe(true)

    // 新设备没有旧设备的 AUTH:SESSIONS / RT：续期必然 40102，应用按设计回登录页
    await waitForEnvelope(captured.entries, entry => entry.url.includes(`/api${AuthRoutes.REFRESH}`) && entry.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED, 30_000)
    await session.page.waitForURL(url => url.pathname === '/auth', { timeout: 30_000 })

    const pathname = new URL(session.page.url()).pathname
    expect(pathname, `自愈后落到了 ${session.page.url()}`).toBe('/auth')
    expect(pathname, '自愈失败才会被踢到 /not-allowed').not.toBe('/not-allowed')

    // 新设备身份合法（cookie 被删 ⇒ initial 签发了新 id），库里也有行
    const newDeviceId = await resolveDeviceId(session.page)
    trackDevice(newDeviceId)
    expect(newDeviceId).toMatch(/^d1_[0-9a-f]{32}$/)
    expect(newDeviceId).not.toBe(oldDeviceId)
    await withPg(async (pg) => {
      expect(await findDeviceRow(pg, newDeviceId)).not.toBeNull()
    })

    captured.stop()
    await session.context.close()
  })

  test('U9 40605 自愈：cookie 与 sys_device 行都被删 → 重新签发合法设备', async ({ browser }) => {
    const session = await loginDevice(browser)
    const oldDeviceId = session.deviceId

    // 删行 + 删设备缓存 + 清 cookie
    await withPg(async (pg) => {
      await pg.query('DELETE FROM sys_device WHERE device_id = $1', [oldDeviceId])
    })
    await withRedis(async (redis) => {
      await deleteDeviceKeys(redis, oldDeviceId)
    })
    await session.context.clearCookies({ name: DEVICE_COOKIE_NAME })

    const captured = captureEnvelopes(session.page)
    // 同 U8：不 reload（blocking sign 会先 40667），在已挂载的应用里触发业务请求
    await navigateInApp(session.page, SystemRoutes.USER)

    const rejected = await waitForEnvelope(captured.entries, entry => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED, 40_000)
    await waitForEnvelope(captured.entries, entry => entry.url.includes(SystemEndpointRoutes.DEVICE_INITIAL) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS, 30_000)

    // 同 U8：新设备触发 CAP，解掉之后旧会话按设备绑定失效（40101 → 续期 40102）并回 /auth
    const { capSolved } = await waitForDeviceHealSettled(session.page, captured.entries, rejected.url)
    expect(capSolved, '自愈产生的新设备应触发 CAP（DEVICE_NEW critical）——若未弹 cap-widget，检查 risk 配置是否被改').toBe(true)

    await waitForEnvelope(captured.entries, entry => entry.url.includes(`/api${AuthRoutes.REFRESH}`) && entry.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED, 30_000)
    await session.page.waitForURL(url => url.pathname === '/auth', { timeout: 30_000 })

    const pathname = new URL(session.page.url()).pathname
    expect(pathname, `自愈后落到了 ${session.page.url()}`).toBe('/auth')
    expect(pathname, '自愈失败才会被踢到 /not-allowed').not.toBe('/not-allowed')

    const newDeviceId = await resolveDeviceId(session.page)
    trackDevice(newDeviceId)
    expect(newDeviceId).toMatch(/^d1_[0-9a-f]{32}$/)
    await withPg(async (pg) => {
      const row = await findDeviceRow(pg, newDeviceId)
      expect(row, '重签后库里没有新行').not.toBeNull()
      expect(row!.ip).toMatch(LOOPBACK_IP_PATTERN)
    })

    captured.stop()
    await session.context.close()
  })

  test('滑动续期：删 COOKIE_RENEW 闸后下一次响应重发 DEVICE_ID（maxAge 拉回 30 天）', async ({ browser }) => {
    const session = await openDevice(browser)
    const deviceId = session.deviceId

    // 先把页面挪走（about:blank）：留在 /auth 上时，应用的 monitor beacon 等后台请求会
    // 在「删闸」与「下一次请求」之间把闸重新写回去（setIfAbsent），续期就不会发生。
    await session.page.goto('about:blank')

    const before = await readDeviceCookie(session.context)
    expect(before).not.toBeNull()

    // 用协议客户端复用浏览器已持有的 DEVICE_ID（值原样，含 `s%3A` 编码），以真实协议触发
    // DeviceGuard。为什么不用 context.request：APIRequestContext **不共享浏览器 context 的
    // cookie**（实测拿到 40605 Unsupported Device），根本走不到续期判定。
    const client = new WalnutProtocolClient({ realIp: session.realIp })
    client.setCookie(DEVICE_COOKIE_NAME, before!.value)

    // 预热：device-guarded 请求写入续期闸（首次通过即 setIfAbsent）
    await client.rawFetch('GET', SystemEndpointRoutes.USER_ME_PROFILE)

    // 删掉闸 = 距上次续期已超过窗口（有效期 30 天的 80%）
    const gateExisted = await withRedis(async (redis) => {
      const value = await redis.get(deviceCookieRenewKey(deviceId))
      await redis.del(deviceCookieRenewKey(deviceId))
      return value !== null
    })
    expect(gateExisted, 'COOKIE_RENEW 闸没写入（续期逻辑没跑过？）').toBe(true)

    // 删闸之后的下一次 device-guarded 响应必须重发 DEVICE_ID，且 maxAge 拉满 30 天。
    // /system/user/me/profile 的 DeviceGuard 在 Sign/JWT 之前，所以即使随后被 40112 拒绝，
    // Set-Cookie 也已经写在响应上。
    const renewed = await client.rawFetch('GET', SystemEndpointRoutes.USER_ME_PROFILE)
    const renewedCookies = renewed.headers.getSetCookie().filter(value => value.startsWith(`${DEVICE_COOKIE_NAME}=`))
    expect(renewedCookies.length, '删掉续期闸后，下一次 device-guarded 响应没有重发 DEVICE_ID').toBeGreaterThan(0)

    const issued = renewedCookies[0]!
    // 有效期 = 30 天（WalnutAdminConstDeviceCookieMaxAge）：这是滑动续期真正刷新的东西
    expect(issued).toContain('Max-Age=2592000')
    const issuedValue = issued.split(';')[0]!.split('=').slice(1).join('=')
    // 设备身份不变：签名的值相同（签名是确定性的）——「轮换」的真实语义是**寿命刷新**
    expect(issuedValue).toBe(before!.value)
    const idOf = (value: string): string => {
      const decoded = decodeURIComponent(value)
      return decoded.startsWith('s:') ? decoded.slice(2).split('.')[0] ?? '' : decoded.split('.')[0] ?? ''
    }
    expect(idOf(issuedValue)).toBe(deviceId)

    // 行还在
    await withPg(async (pg) => {
      expect(await findDeviceRow(pg, deviceId)).not.toBeNull()
    })

    // 负对照：闸已存在时再打一次，不应重发 DEVICE_ID（证明「重发」确实由这个键控制）
    const control = await client.rawFetch('GET', SystemEndpointRoutes.USER_ME_PROFILE)
    const controlCookies = control.headers.getSetCookie().filter(value => value.startsWith(`${DEVICE_COOKIE_NAME}=`))
    expect(controlCookies, '续期闸存在时仍重发了 DEVICE_ID —— 滑动续期的判据失效').toHaveLength(0)

    await session.context.close()
  })

  test('封禁 / 锁定跳转：同一台 victim 先 ban 再 lock，分别 40607 / 40606', async ({ browser }) => {
    const victim = await loginDevice(browser)
    const victimId = victim.deviceId
    const uuid = await deviceRowUuid(victimId)
    const root = await rootClient()
    const captured = captureEnvelopes(victim.page)

    try {
      // 两个阶段用 test.step 分段：合并的是登录（同一条 victim 设备），失败定位仍在具体阶段。
      await test.step('ban：40607 → /not-allowed?type=deviceBanned', async () => {
        await root.client.root('PATCH', `${SystemRoutes.DEVICE}/${uuid}/ban`)
        await victim.page.reload()

        const banned = await waitForEnvelope(captured.entries, entry => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED, 40_000)
        expect(banned.code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)
        await victim.page.waitForURL(url => url.pathname === '/not-allowed' && url.search.includes('type=deviceBanned'), { timeout: 30_000 })
        expect(victim.page.url()).toContain('type=deviceBanned')

        await withPg(async (pg) => {
          const row = await findDeviceRow(pg, victimId)
          expect(row?.banned).toBe(true)
        })
      })

      await test.step('lock：解封后锁定，40606 → /not-allowed?type=deviceLocked', async () => {
        // DeviceGuard 的判定顺序是 banned 先于 locked：不先解封，锁定状态永远看不到 40606。
        await root.client.root('PATCH', `${SystemRoutes.DEVICE}/${uuid}/unban`)
        await root.client.root('PATCH', `${SystemRoutes.DEVICE}/${uuid}/lock`)
        // 不能 reload /not-allowed：那页只是按 query 渲染错误文案，不会发受设备守卫保护的请求，
        // 也就不会有新的 40606。回首页重新走一次应用引导，让受保护请求去撞 DeviceGuard。
        await victim.page.goto('/')

        const locked = await waitForEnvelope(captured.entries, entry => entry.code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED, 40_000)
        expect(locked.code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED)
        await victim.page.waitForURL(url => url.pathname === '/not-allowed' && url.search.includes('type=deviceLocked'), { timeout: 30_000 })
        expect(victim.page.url()).toContain('type=deviceLocked')

        await withPg(async (pg) => {
          const row = await findDeviceRow(pg, victimId)
          expect(row?.locked).toBe(true)
          expect(row?.banned).toBe(false)
        })
      })
    }
    finally {
      captured.stop()
      await victim.context.close()
    }
  })

  test('回填 created_at=1h → 重登触发 DEVICE_NEW critical 因子的 CAP', async ({ browser }) => {
    // 一次协议登录 + 一次 UI 登录（CAP PoW + TOTP），距 120s 默认上限的余量仍然不大
    test.slow()
    const seeded = await seedLoggedInDevice(HOUR_MS)
    const context = await contextOnSeededDevice(browser, seeded)

    try {
      const page = await context.newPage()
      const result = await loginViaUI(page)
      expect(result.capSolved, 'DEVICE_NEW（1 小时内新设备）应触发 cap-widget').toBe(true)
      // 注入失败时 UI 登录会自愈成另一台新设备 —— 那时的 CAP 证明不了「预置设备」这条路径
      expect(await resolveDeviceId(page), 'cookie 注入后 UI 登录应沿用预置设备').toBe(seeded.deviceId)

      const risk = await withRedis(async redis => readRiskDevice(redis, seeded.deviceId))
      expect(risk?.factors ?? [], `风险因子应含 DEVICE_NEW，实际 ${JSON.stringify(risk?.factors)}`).toContain('DEVICE_NEW')
    }
    finally {
      await context.close()
    }
  })

  test('回填 created_at=3d → 重登触发 DEVICE_RECENT critical 因子的 CAP', async ({ browser }) => {
    // 一次协议登录 + 一次 UI 登录（CAP PoW + TOTP），距 120s 默认上限的余量仍然不大
    test.slow()
    const seeded = await seedLoggedInDevice(3 * DAY_MS)
    const context = await contextOnSeededDevice(browser, seeded)

    try {
      const page = await context.newPage()
      const result = await loginViaUI(page)
      expect(result.capSolved, 'DEVICE_RECENT（3 天前设备）应触发 cap-widget').toBe(true)
      // 注入失败时 UI 登录会自愈成另一台新设备 —— 那台设备会带 DEVICE_NEW，测不到 RECENT
      expect(await resolveDeviceId(page), 'cookie 注入后 UI 登录应沿用预置设备').toBe(seeded.deviceId)

      const risk = await withRedis(async redis => readRiskDevice(redis, seeded.deviceId))
      expect(risk?.factors ?? [], `风险因子应含 DEVICE_RECENT，实际 ${JSON.stringify(risk?.factors)}`).toContain('DEVICE_RECENT')
    }
    finally {
      await context.close()
    }
  })
})
