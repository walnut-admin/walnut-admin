/**
 * 浏览器侧用例的共享动作：UI 登录（含 CAP / MFA）、登录态探测、页面响应采集、
 * localStorage 设备 id 读取。
 *
 * 选择器尽量用**结构 / 语义**（autocomplete、form、w-menu、cap-widget）而不是中文文案 ——
 * 文案来自 DB 语言包（sys_locale），换语言就断；结构是组件的契约。
 */
import type { BrowserContext, Page, Response } from '@playwright/test'
import { expect } from '@playwright/test'
import { generateSync } from 'otplib'
import { DEVICE_COOKIE_NAME, readCredentials } from '../scripts/env.ts'

/** `useAppStorageSync` 的键 = `WA__<KEY>`（getStorageKey 的默认前缀）+ superjson 包一层 `{v,e,_v}` */
export const DEVICE_LOCAL_STORAGE_KEY = 'WA__GEO_IP_DEVICE_ID'
export const ACCESS_TOKEN_LOCAL_STORAGE_KEY = 'WA__ACCESS_TOKEN'

export interface CapturedEnvelope {
  url: string
  method: string
  /** HTTP 状态（业务错误也是 200，所以它只用来区分网关/代理错误） */
  status: number
  /** 业务码（响应壳 `{code}`；非统一壳的端点没有这个字段） */
  code?: number
  msg?: string
}

/** 采集当前 page 的所有 JSON 响应（业务码 + URL），返回一个可读数组与停止函数 */
export function captureEnvelopes(page: Page): { entries: CapturedEnvelope[], stop: () => void } {
  const entries: CapturedEnvelope[] = []

  const handler = (response: Response): void => {
    void (async () => {
      try {
        const contentType = response.headers()['content-type'] ?? ''
        if (!contentType.includes('application/json')) {
          return
        }
        const body = await response.json() as { code?: number, msg?: string }
        entries.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          code: typeof body.code === 'number' ? body.code : undefined,
          msg: body.msg,
        })
      }
      catch {
        // 响应体已被释放 / 不是 JSON：忽略（采集是辅助断言，不该让用例炸）
      }
    })()
  }

  page.on('response', handler)
  return { entries, stop: () => page.off('response', handler) }
}

/** 等某个条件在采集数组里出现（轮询，避免依赖响应到达顺序） */
export async function waitForEnvelope(
  entries: CapturedEnvelope[],
  predicate: (entry: CapturedEnvelope) => boolean,
  timeoutMs = 30_000,
): Promise<CapturedEnvelope> {
  const started = Date.now()
  for (;;) {
    const hit = entries.find(predicate)
    if (hit !== undefined) {
      return hit
    }
    if (Date.now() - started > timeoutMs) {
      // 文案用**实际**传入的超时（曾经硬编码 30s，改成 40s 的调用点报错里还在说 30s）
      const recent = entries.slice(-12).map((entry) => {
        const code = entry.code === undefined ? '' : ` ${entry.code}`
        return `${entry.method} ${entry.url}${code}`
      })
      throw new Error(
        `[e2e/ui] ${Math.round(timeoutMs / 1000)}s 内没等到目标响应；已采集（末 ${recent.length} 条）：\n${recent.join('\n')}`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** 读浏览器 localStorage 里的设备 id（`WA__GEO_IP_DEVICE_ID` 的 superjson 包装体） */
export async function readLocalDeviceId(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (raw === null) {
      return null
    }
    try {
      // superjson 会把对象根包成 `{ json: {...} }`（`{v,e,_v}` 整体是对象）；平铺形态 `{v}`
      // 也兼容。两种都收，避免用例对存储层的实现细节过敏。
      const parsed = JSON.parse(raw) as { v?: unknown, json?: { v?: unknown } }
      const value = parsed.json?.v ?? parsed.v
      return typeof value === 'string' ? value : null
    }
    catch {
      return null
    }
  }, DEVICE_LOCAL_STORAGE_KEY)
}

/** context 里的 DEVICE_ID cookie（stage 形态无前缀；值带 `s:` 签名，原样返回） */
export async function readDeviceCookie(context: BrowserContext): Promise<{ value: string, secure: boolean, httpOnly: boolean, path: string, expires: number, domain: string } | null> {
  const cookies = await context.cookies()
  const cookie = cookies.find(item => item.name === DEVICE_COOKIE_NAME)
  return cookie === undefined
    ? null
    : {
        value: cookie.value,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        path: cookie.path,
        expires: cookie.expires,
        domain: cookie.domain,
      }
}

/** 生成当前 TOTP 六位码（与后端 otplib 的默认 TOTP 参数一致：30s / sha1 / 6 位） */
export function currentTotp(secret: string): string {
  return generateSync({ secret })
}

/**
 * 若 cap-widget 出现则点它并等它消失。
 *
 * cap.js 的 standalone widget 是一个需要在 shadow DOM 里点一下的复选框；点完它自己做 PoW
 * （WASM 从 jsDelivr 拉）并发出 `solve` 事件，拦截器随后重放原请求、组件 1s 后关闭 modal。
 */
export async function solveCapIfPresent(page: Page, timeoutMs = 60_000, appearTimeoutMs = 6_000): Promise<boolean> {
  const widget = page.locator('cap-widget').first()

  try {
    await widget.waitFor({ state: 'visible', timeout: appearTimeoutMs })
  }
  catch {
    return false
  }

  await widget.click()
  await widget.waitFor({ state: 'hidden', timeout: timeoutMs })
  return true
}

/**
 * 过 MFA 验证页（`/mfa-verified`）：点唯一启用中的方法卡 → 输入 TOTP → 回车。
 * 页面没出现则直接返回 false（未绑定 / 设备已 trusted 的路径）。
 */
export async function verifyMfaIfPresent(page: Page, totpSecret: string, timeoutMs = 20_000): Promise<boolean> {
  try {
    await page.waitForURL(url => url.pathname === '/mfa-verified', { timeout: 8_000 })
  }
  catch {
    return false
  }

  // 只有 TOTP 一个方法启用（WebAuthn 未绑定）⇒ 可见卡片唯一。
  // 必须加 :visible —— 登录页的卡片仍挂在 DOM 里（懒卸载），裸 .first() 会点到隐藏的那个。
  await page.locator('.w-card:visible').first().click()
  const input = page.locator('input[placeholder="000000"]:visible')
  await input.waitFor({ state: 'visible', timeout: 10_000 })
  await input.fill(currentTotp(totpSecret))
  await input.press('Enter')

  // 验证通过后 ExecuteCoreFnAfterAuth 会 goIndex → 离开 /mfa-verified
  await page.waitForURL(url => url.pathname !== '/mfa-verified', { timeout: timeoutMs })
  return true
}

export interface LoginResult {
  /** 是否走了 CAP 交互 */
  capSolved: boolean
  /** 是否过了 MFA 验证页 */
  mfaVerified: boolean
  /** 登录后的落地 URL */
  url: string
}

/**
 * 完整 UI 登录：填表 → 提交 → （CAP）→（MFA）→ 落到首页/内页。
 * 失败时抛出并附上当前 URL 与标题，便于定位卡在哪一步。
 */
export async function loginViaUI(page: Page, options: { userName?: string, password?: string, totpSecret?: string } = {}): Promise<LoginResult> {
  const credentials = options.userName !== undefined
    ? { userName: options.userName, password: options.password ?? '', totpSecret: options.totpSecret ?? '' }
    : readCredentials()

  await page.goto('/auth')

  // 启动序列里就有请求可能被判「需要人机交互」（新设备的 DEVICE_NEW critical 因子）——
  // CAP 是 **WModal + 全屏 mask**，不先解掉它，登录表单点不动（fill 也会被焦点陷阱吞掉）。
  const capAfterBoot = await solveCapIfPresent(page)

  const userNameInput = page.locator('input[autocomplete="username"]')
  await userNameInput.waitFor({ state: 'visible', timeout: 30_000 })
  await userNameInput.fill(credentials.userName)

  const passwordInput = page.locator('input[autocomplete="current-password"]')
  await passwordInput.fill(credentials.password)
  // Extra:Password 在 Enter 上触发 submit（比找按钮稳：按钮文案来自 DB 语言包）
  await passwordInput.press('Enter')

  const capAfterLogin = await solveCapIfPresent(page, 60_000, 10_000)
  const capSolved = capAfterBoot || capAfterLogin
  const mfaVerified = await verifyMfaIfPresent(page, credentials.totpSecret)

  // 登录成功的判据：离开 /auth 与 /mfa-verified，并出现应用外壳（侧边栏菜单）
  await page.waitForURL(url => url.pathname !== '/auth' && url.pathname !== '/mfa-verified', { timeout: 40_000 })
  await page.locator('.w-menu').first().waitFor({ state: 'visible', timeout: 30_000 })

  return { capSolved, mfaVerified, url: page.url() }
}

/**
 * 保证当前 page 处于登录态：先打开站点；若落到登录页则走 UI 登录。
 *
 * storageState 复用已判死（IndexedDB 里的 AES `CryptoKey` 恢复不了，见 playwright.config.ts），
 * 所以每次都是「打开站点 → 走登录」。保留 shell 分支是防御性的：将来若真有了可复用的登录态，
 * 这里不需要改。
 */
export async function ensureLoggedIn(page: Page): Promise<LoginResult | null> {
  await page.goto('/')
  // 登录页上可能先弹 CAP（bootstrap 请求触发）；它带全屏 mask，会挡住后续交互
  await solveCapIfPresent(page)

  const shell = page.locator('.w-menu').first()
  const loginForm = page.locator('input[autocomplete="username"]')

  const outcome = await Promise.race([
    shell.waitFor({ state: 'visible', timeout: 40_000 }).then(() => 'shell' as const),
    loginForm.waitFor({ state: 'visible', timeout: 40_000 }).then(() => 'login' as const),
  ]).catch(() => 'timeout' as const)

  if (outcome === 'shell') {
    return null
  }
  if (outcome === 'timeout') {
    throw new Error(`[e2e/ui] 打开站点后 40s 内既没出现登录表单也没出现应用外壳（URL=${page.url()}）`)
  }

  return loginViaUI(page)
}

/** 断言侧边栏至少渲染出一个菜单项（menus 来自 /auth/permissions 的真实数据） */
export async function expectSidebarRendered(page: Page): Promise<void> {
  const items = page.locator('.w-menu .w-menu-item-content').first()
  await expect(items).toBeVisible({ timeout: 30_000 })
}

/**
 * 在**已挂载**的应用里触发一次真实业务请求（不刷新页面）。
 *
 * 为什么不能 reload：丢掉 DEVICE_ID cookie 后整页重载会先卡在 bootstrap 的 blocking
 * `sign` 步骤 —— `/security/sign/*` 是风控 `fail-close`，缺 deviceId ⇒ 40667，应用直接
 * 进错误屏，40605 自愈永远跑不到。P0-1 的自愈面是「已挂载应用里的请求」：用
 * pushState + popstate 让 vue-router 路由到目标页，页面挂载时自己发业务请求。
 */
export async function navigateInApp(page: Page, pathname: string): Promise<void> {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathname)
}
