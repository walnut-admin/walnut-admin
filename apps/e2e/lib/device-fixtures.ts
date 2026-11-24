/**
 * 设备用例的 fixture 层：开一台「全新浏览器设备」、读它的 deviceId、用完按 deviceId 自清理。
 *
 * 为什么每个用例自己开 context：**全新 context（无 cookie）天然就是一台新设备** ——
 * 这正是设备生命周期的起点（`/system/device/initial` 是唯一签发点）。共用 project 的
 * storageState 会把「新设备」变成「复用别人设备」，U1 那类断言就失去意义。
 */
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { DEVICE_COOKIE_NAME, WEB_ORIGIN } from '../scripts/env.ts'
import { deleteDeviceRow, withPg } from './pg.ts'
import { SIGN_USER_AGENT } from './protocol/sign.ts'
import { deleteDeviceKeys, deleteRiskDeviceState, withRedis } from './redis.ts'
import { loginViaUI, readDeviceCookie, readLocalDeviceId } from './ui.ts'

export interface DeviceSession {
  context: BrowserContext
  page: Page
  /** 已登记的 deviceId（打开站点后才有） */
  deviceId: string
  /** 本会话使用的 local IP（XFF；每台设备一个，避开 device/initial 的 4 次/60s 限流桶） */
  realIp: string
}

/**
 * 给一台设备分配一个 **127/8 的 local IP**（不是 127.0.0.1）。
 *
 * 为什么必须每台设备一个：`POST /system/device/initial` 挂着 settings 驱动的 throttle
 * （`SysDeviceSettingService`：**4 次 / 60 秒**），tracker 是 `req.realIp`。E2E 的浏览器流量
 * 都经静态代理过来，若 XFF 一律是 127.0.0.1，同一分钟内第 5 台设备登记就会 42900
 * （前端跳 /not-allowed?type=tooManyRequests，后续用例全挂）。
 * 127/8 既是 local（`is-localhost-ip` 判 true ⇒ getLocalLocation、零外网），又各自独立计数。
 */
let localIpSeq = 0
export function uniqueLocalIp(): string {
  localIpSeq = (localIpSeq + 1) % 240
  return `127.0.${1 + Math.floor(localIpSeq / 200)}.${10 + localIpSeq}`
}

/**
 * 只给**同源 /api 请求**加 `X-Forwarded-For`（= 后端 req.realIp），不能整包 extraHTTPHeaders：
 * 那个选项对**所有**请求生效，包括 cap.js 从 jsDelivr 拉的 WASM —— 自定义头会触发 CORS
 * 预检，jsDelivr 的 ACAO 不放行 `x-forwarded-for`，WASM 加载失败 ⇒ cap-widget 直接进错误态
 * （截图里的「你是人类吗？」）并把用例卡在 60s。静态资源与第三方请求不需要这个头。
 */
export async function installRealIpRoute(context: BrowserContext, realIp: string): Promise<void> {
  await context.route(
    url => url.origin === WEB_ORIGIN && url.pathname.startsWith('/api/'),
    route => route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': realIp },
    }),
  )
}

export async function newBrowserContext(browser: Browser, options: { realIp?: string } = {}): Promise<BrowserContext> {
  const realIp = options.realIp ?? uniqueLocalIp()
  const context = await browser.newContext({
    // 显式给 baseURL：测试里 `browser.newContext()` 会继承 test 的 use，但独立脚本
    // （排障用）不会 —— 让 context 自包含，两条腿都用相对路径。
    baseURL: WEB_ORIGIN,
    userAgent: SIGN_USER_AGENT,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1600, height: 900 },
  })
  await installRealIpRoute(context, realIp)
  return context
}

/** 从 Cookie（stage 无前缀）解出设备 id；cookie 没有时回落 localStorage */
export async function resolveDeviceId(page: Page): Promise<string> {
  const cookie = await readDeviceCookie(page.context())
  if (cookie !== null) {
    const decoded = decodeURIComponent(cookie.value)
    const value = decoded.startsWith('s:') ? decoded.slice(2).split('.')[0] ?? '' : decoded.split('.')[0] ?? ''
    if (value !== '') {
      return value
    }
  }

  const local = await readLocalDeviceId(page)
  if (local !== null) {
    return local
  }
  throw new Error(`[e2e/device] 既没有 ${DEVICE_COOKIE_NAME} cookie 也没有 localStorage 设备 id（URL=${page.url()}）`)
}

/** 打开站点（默认落在登录页）→ 等 bootstrap 完成设备登记 → 返回 deviceId */
export async function openDevice(browser: Browser, startAt = '/auth', options: { realIp?: string } = {}): Promise<DeviceSession> {
  const realIp = options.realIp ?? uniqueLocalIp()
  const context = await newBrowserContext(browser, { realIp })
  const page = await context.newPage()
  await page.goto(startAt)
  // bootstrap 的 device-id 步骤是 degraded（失败也会进页面）——判据必须是「localStorage 里
  // 已经是服务端签发的 d1_ id」，不是「键存在」：store 初始化时会先写一份 {v:null} 占位，
  // 只等键会让后面读 id 的断言撞 null。
  await page.waitForFunction(
    (localKey) => {
      const raw = window.localStorage.getItem(localKey)
      if (raw === null) {
        return false
      }
      try {
        const parsed = JSON.parse(raw) as { v?: unknown, json?: { v?: unknown } }
        const value = parsed.json?.v ?? parsed.v
        return typeof value === 'string' && /^d1_[0-9a-f]{32}$/.test(value)
      }
      catch {
        return false
      }
    },
    'WA__GEO_IP_DEVICE_ID',
    { timeout: 30_000 },
  )
  const deviceId = await resolveDeviceId(page)
  return { context, page, deviceId, realIp }
}

/** 开一台设备并完成 UI 登录（CAP + MFA），返回已登录会话 */
export async function loginDevice(browser: Browser, options: { realIp?: string } = {}): Promise<DeviceSession> {
  const session = await openDevice(browser, '/auth', options)
  await loginViaUI(session.page)
  session.deviceId = await resolveDeviceId(session.page)
  return session
}

/**
 * 按 deviceId 自清理：PG 行（user_device / refresh_token 的 FK 是 CASCADE）+ 该设备的所有
 * Redis 键（设备缓存 / 续期闸 / 风控评估 / 挑战标记）。**不 FLUSHDB**。
 */
export async function cleanupDevices(deviceIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(deviceIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) {
    return
  }

  await withPg(async (pg) => {
    for (const id of ids) {
      await deleteDeviceRow(pg, id)
    }
  })
  await withRedis(async (redis) => {
    for (const id of ids) {
      await deleteDeviceKeys(redis, id)
      await deleteRiskDeviceState(redis, id)
    }
  })
}

/** 关 context（清理失败不掩盖断言失败） */
export async function closeSession(session: DeviceSession): Promise<void> {
  await session.context.close().catch(() => {})
}

/** 站点根 URL（少数场景需要绝对地址） */
export const siteRoot = WEB_ORIGIN
