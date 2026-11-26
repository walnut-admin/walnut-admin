/**
 * 设备用例的 fixture 层：开一台「全新浏览器设备」、读它的 deviceId、按 deviceId 自清理。
 *
 * 为什么每个用例自己开 context：**全新 context（无 cookie）天然就是一台新设备** ——
 * 这正是设备生命周期的起点（`/system/device/initial` 是唯一签发点）。共用 project 的
 * storageState 会把「新设备」变成「复用别人设备」，U1 那类断言就失去意义
 * （storageState 能否复用也已实测判死，见 playwright.config.ts 的注释）。
 *
 * 清理分两步（P1-2）：这里的 {@link trackDevice} 只**登记**，真正的清理由
 * `tests/fixtures.ts` 的 auto fixture 在用例结束时统一做 —— 断言失败时用例末尾的手写清理
 * 会被跳过，而 fixture 的 teardown 照样执行。
 */
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import process from 'node:process'
import { DEVICE_COOKIE_NAME, WEB_ORIGIN } from '../scripts/env.ts'
import { localIpFor, STACK_PROFILE } from '../scripts/stack-profiles.ts'
import { deleteDeviceRow, withPg } from './pg.ts'
import { SIGN_USER_AGENT } from './protocol/sign.ts'
import { deleteDeviceScopedKeys, deleteRiskDeviceState, withRedis } from './redis.ts'
import { DEVICE_LOCAL_STORAGE_KEY, loginViaUI, readDeviceCookie, readLocalDeviceId } from './ui.ts'

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
 *
 * **profile 偏移（P1-6）**：第三段按 profile 的 `ipSlot` 偏移（default 1–2、smoke 11–12、
 * risk 21–22、network 31–32、pages 41–42、journey 51–52），公式在 `scripts/stack-profiles.ts`
 * 的 `localIpFor`。必要性在
 * Redis：`risk:rate:ip:<ip>:<分钟>` 是服务端键（同机共享 Redis），只有跨 profile 的 IP 段
 * 不相交，才不会互相吃 4 次/60s 的额度。
 */
/**
 * 每进程从 **pid 偏移**开始分配，而不是固定从 0 开始。
 *
 * R4 实测：Playwright 每个 spec 文件是独立的 worker 进程，模块级序号在文件之间重置 ——
 * 固定从 seq=0 起步会让每个文件的第一个客户端都拿 `127.0.<slot>.11`，叠加起来撞上
 * `device/initial` 的 4 次 / 60 秒 per realIp 桶（新增模块 spec 后 smoke 全跑首次复现）。
 * pid 偏移让同一轮的多个 worker 各自落在不同的地址窗口；仍限制在 profile 的两个 /24 内
 * （`localIpFor` 不变，跨 profile 不重叠的性质不变）。`bootstrap()` 另有 42900 换地址重放兜底。
 */
let localIpSeq = process.pid % 240
export function uniqueLocalIp(): string {
  localIpSeq = (localIpSeq + 1) % 240
  return localIpFor(STACK_PROFILE.ipSlot, localIpSeq)
}
/**
 * 只给**同源 /api 请求**加 `X-Forwarded-For`（= 后端 req.realIp），不能整包 extraHTTPHeaders：
 * 那个选项对**所有**请求生效，包括第三方跨域资源（例如 CDN 上的 WASM）—— 自定义头会触发
 * CORS 预检，对方通常不放行 `x-forwarded-for`，资源加载失败 ⇒ 依赖它的组件直接进错误态
 * （CAP 场景的截图是「你是人类吗？」）并把用例卡住。静态资源与第三方请求不需要这个头。
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

  // 首访的「Star on GitHub」通知（duration 60s，右上角）会盖住 header 右侧控件 / 弹层，
  // Playwright 的 click/fill 会因此等到它自动消失（60s），把用例拖到超时。
  // 这是产品提示，不是被测行为 —— 与 driver intro 同口径预置成「不再显示」。
  await context.addCookies([{ name: 'dont-show-star', value: 'true', url: WEB_ORIGIN }])

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
  const deviceId = await waitForRegisteredDevice(page)
  trackDevice(deviceId)
  return { context, page, deviceId, realIp }
}

/**
 * 等页面完成设备登记，返回服务端签发的 deviceId（**不**登记给清理 fixture —— 调用方决定）。
 *
 * 拆出来给两个消费方：{@link openDevice}（自建 context）与 mobile 布局用例（用 project 的
 * `page` 以便继承设备描述符，不能走 `newBrowserContext` 的 1600×900 覆盖）。
 *
 * 判据是「localStorage 里已经是服务端签发的 d1_ id」，不是「键存在」：store 初始化会先写
 * 一份 `{v:null}` 占位，只等键会让后面读 id 的断言撞 null。
 */
export async function waitForRegisteredDevice(page: Page): Promise<string> {
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
    DEVICE_LOCAL_STORAGE_KEY,
    { timeout: 30_000 },
  )
  return resolveDeviceId(page)
}

/** 开一台设备并完成 UI 登录（CAP + MFA），返回已登录会话 */
export async function loginDevice(browser: Browser, options: { realIp?: string } = {}): Promise<DeviceSession> {
  const session = await openDevice(browser, '/auth', options)
  await loginViaUI(session.page)
  session.deviceId = await resolveDeviceId(session.page)
  trackDevice(session.deviceId)
  return session
}

/** 本用例里已登记、还没清理的设备（Set 天然去重） */
const trackedDeviceIds = new Set<string>()
/**
 * 本 worker 生命周期内复用的设备（当前只有 `tests/fixtures.ts` 的共享只读 context）。
 *
 * 与上面分开的理由：test 作用域的 auto fixture 每条用例结束都会清一次 `trackedDeviceIds`，
 * 把 worker 级共享设备混进去会在第一条用例结束时就被删掉 —— 共享 context 随后的请求会
 * 40605 自愈成一台新设备，后续只读用例就测不到原来的登录态了。两个集合都由 fixture 清理
 * （test 作用域清前者，worker 作用域清后者），仍然不违反「设备清理归 fixture」。
 */
const workerTrackedDeviceIds = new Set<string>()

/**
 * 登记一台**本用例造出来**的设备，交给 `tests/fixtures.ts` 的 auto fixture 收尾。
 *
 * 工厂函数（{@link openDevice} / {@link loginDevice}）已经自动登记；这里给两类手写场景：
 * 直接打 `POST /system/device/initial` 拿到 id 的用例（U1 / Phase0-4），以及自愈后换了身份的
 * 用例（U8 / U9 的 `resolveDeviceId` 结果）。
 */
export function trackDevice(deviceId: string | null | undefined): void {
  if (typeof deviceId === 'string' && deviceId !== '') {
    trackedDeviceIds.add(deviceId)
  }
}

/**
 * 登记一台**跨用例复用**的设备（worker 作用域），由 worker 级 auto fixture 在进程退出时清理。
 *
 * 只给共享只读 context 用：它的登录态要在同一 worker 的多条用例间存活，不能被某条用例的
 * test 作用域清理顺手删掉（见 {@link workerTrackedDeviceIds} 的注释）。
 */
export function trackWorkerDevice(deviceId: string | null | undefined): void {
  if (typeof deviceId === 'string' && deviceId !== '') {
    workerTrackedDeviceIds.add(deviceId)
  }
}

/**
 * 清掉目前已登记的设备（PG 行 + 该设备的全部 Redis 键）。
 *
 * **不抛错**：清理失败只 `console.warn`，并把 id 重新登记（worker 级兜底会再试一次）——
 * 清理是收尾动作，绝不能让它的失败掩盖真正的断言失败。
 */
export async function flushTrackedDevices(options: { testInfo?: TestInfo } = {}): Promise<void> {
  await flushDeviceSet(trackedDeviceIds, options)
}

/** worker 作用域设备的清理（与 {@link flushTrackedDevices} 同口径，失败不抛错） */
export async function flushWorkerTrackedDevices(options: { testInfo?: TestInfo } = {}): Promise<void> {
  await flushDeviceSet(workerTrackedDeviceIds, options)
}

async function flushDeviceSet(idsSet: Set<string>, options: { testInfo?: TestInfo }): Promise<void> {
  const ids = [...idsSet]
  idsSet.clear()
  if (ids.length === 0) {
    return
  }

  try {
    await cleanupDevices(ids)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[e2e/fixtures] 设备清理失败（不影响断言结果；worker 退出时再试一次）：${ids.join(', ')} —— ${message}`)
    for (const id of ids) {
      idsSet.add(id)
    }
    if (options.testInfo !== undefined) {
      await options.testInfo.attach('device-cleanup-failure', {
        body: JSON.stringify({ deviceIds: ids, error: message }, null, 2),
        contentType: 'application/json',
      }).catch(() => {})
    }
  }
}

/**
 * 按 deviceId 自清理：PG 行（sys_user_device / auth_refresh_token 的 FK 是 CASCADE）+ 该设备的
 * **全部** Redis 键（设备缓存 / 续期闸 / 登录会话 / 权限 / MFA / 签名 / CAP / 风控评估与挑战标记）。
 * **不 FLUSHDB**。
 */
async function cleanupDevices(deviceIds: (string | null | undefined)[]): Promise<void> {
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
      await deleteDeviceScopedKeys(redis, id)
      await deleteRiskDeviceState(redis, id)
    }
  })
}
