/**
 * 浏览器侧用例的共享动作：UI 登录（含 CAP / MFA）、登录态探测、页面响应采集、
 * localStorage 设备 id 读取。
 *
 * 选择器尽量用**结构 / 语义**（autocomplete、form、w-menu、cap-widget）而不是中文文案 ——
 * 文案来自 DB 语言包（sys_locale），换语言就断；结构是组件的契约。
 *
 * P2-4 起登录表单 / 侧边栏 / MFA 卡片三处改用 admin 源码里的 `data-testid`：
 * **testid 优先、旧结构选择器兜底**（逗号选择器在同一个元素上会去重，不是二选一）；
 * 兜底是为了兼容「admin 已改、stage 产物还没重建」的过渡态，不是长期契约。
 * 新增依赖页面的选择器时先回 admin 源码加 testid，别把 `:has-text()` 当主选择器。
 */
import type { BrowserContext, Page, Response } from '@playwright/test'
import type { WaitBudget } from './wait-budget.ts'
import process from 'node:process'
import { expect } from '@playwright/test'
import { generateSync } from 'otplib'
import { DEVICE_COOKIE_NAME, readCredentials, WEB_ORIGIN } from '../scripts/env.ts'
import { WalnutAdminConstAppResponseCode } from './protocol/contract.ts'
import { redactText } from './redact.ts'
import { budgetStep, startWaitBudget } from './wait-budget.ts'

/**
 * 登录链路（打开页面 → 填表 → CAP → MFA → 落地）的**总等待预算**，从链路起点计时。
 *
 * 单步 timeout 只作子预算：CAP 求解（60s 消失）与 MFA（20s 落地）都可能在慢环境里各吃一半，
 * 叠起来就撞全局 120s —— 那里的报错没有现场。90s 留 30s 给失败上下文采集（5s）、
 * fixture 收尾与导航本身。U8 / U9 的慢用例另按需 `test.slow()`，不靠这里加宽。
 */
export const LOGIN_TOTAL_BUDGET_MS = 90_000

/** 该步的 Playwright 超时：`min(步骤上限, 链路剩余预算)`，耗尽时抛出点名步骤的错误 */
function stepTimeout(budget: WaitBudget, step: string, capMs: number): number {
  return budgetStep(budget, step, capMs)
}

/** 登录表单：用户名 / 密码 / 提交（testid 见 admin 的 opaque.vue 与 Extra/Password） */
export const LOGIN_USERNAME_SELECTOR =
  '[data-testid="login-username"], input[autocomplete="username"]'
export const LOGIN_PASSWORD_SELECTOR =
  '[data-testid="login-password"], input[autocomplete="current-password"]'
/** 应用外壳：侧边栏容器与菜单项（testid 见 TheAside/src/menu.vue；导出给用例做计数断言） */
export const SIDEBAR_MENU_SELECTOR = '[data-testid="sidebar-menu"], .w-menu'
export const SIDEBAR_MENU_ITEM_SELECTOR =
  '[data-testid="sidebar-menu-item"], .w-menu .w-menu-item-content'
/** MFA 验证页：方法卡 / 6 位码输入（testid 见 views/error/MfaVerified/index.vue） */
const MFA_METHOD_CARD_SELECTOR = '[data-testid="mfa-method-card"]:visible, .w-card:visible'
const MFA_CODE_INPUT_SELECTOR =
  '[data-testid="mfa-code-input"]:visible, input[placeholder="000000"]:visible'
/**
 * cap.js 交互 widget（standalone，需要点一下的复选框）。U13 的 post-auth CAP 重武装
 * 要在「对话框可见」这一步断言它，所以选择器从实现细节提升为导出常量。
 */
export const CAP_WIDGET_SELECTOR = 'cap-widget'

/** `useAppStorageSync` 的键 = `WA__<KEY>`（getStorageKey 的默认前缀）+ superjson 包一层 `{v,e,_v}` */
export const DEVICE_LOCAL_STORAGE_KEY = 'WA__GEO_IP_DEVICE_ID'
/**
 * 浏览器指纹（`useAppStorageSync(FINGERPRINT)`，当前用它的只有 socket 房间键、
 * monitor 心跳的 `visitorId` 与 WebAuthn 的设备名建议值）。**每个 E2E context 预置一个唯一值**，
 * 理由见 `device-fixtures.ts` 的 seedFingerprint：真机指纹是「浏览器安装级」的，
 * 同一台机器上所有 context 会算出同一个值，而 `app_monitor_user.visitor_id` 有唯一约束 ——
 * 第二个 context 的心跳必然冲突（行键 deviceId 不同 ⇒ upsert 走 INSERT ⇒ 23505）。
 */
export const FINGERPRINT_LOCAL_STORAGE_KEY = 'WA__FINGERPRINT'
/**
 * 应用引导（driver.js）的「已看过」cookie，真源是 admin 的 `useDriver('app-intro')`
 * （`driver-${key}`）。引导是全屏 SVG overlay 且 `allowClose: false`（关不掉），会拦截
 * cap-widget / 页头下拉的点击 —— 它只与首次使用的 UI 引导有关，与设备 / CAP / 权限断言无关，
 * 测试里预置成已看过。
 */
const APP_INTRO_COOKIE_NAME = 'driver-app-intro'

/**
 * 把 driver.js 引导标成「已看过」（当前 page 的 origin）。
 *
 * 要在**首次进入 default layout 之前**调用：overlay 一旦出来就没有关闭入口。`loginViaUI`
 * 已经内置；自己写登录链路（例如 WebAuthn 的 `/mfa-required` → `/mfa-verified`）时必须显式调，
 * 否则进系统后整个页面被引导遮罩盖住，页头下拉 / 卡片点击全部被拦截。
 */
export async function markAppIntroSeen(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: APP_INTRO_COOKIE_NAME, value: 'true', url: new URL(page.url()).origin }])
}

export interface CapturedEnvelope {
  url: string
  method: string
  /** HTTP 状态（业务错误也是 200，所以它只用来区分网关/代理错误） */
  status: number
  /** 业务码（响应壳 `{code}`；非统一壳的端点没有这个字段） */
  code?: number
  msg?: string
}

/** 采集条目 + 全局到达序号（`snapshotRecentEnvelopes` 跨 capture 合并排序用，不对外暴露） */
interface SequencedEnvelope extends CapturedEnvelope {
  __seq: number
}

/**
 * 所有 `captureEnvelopes` 实例的**模块级登记**：失败现场要能拿到「最近 N 条业务响应」。
 *
 * 为什么用登记而不是让每个 spec 自己 attach：失败可能发生在任何一条断言 / 等待里，
 * 让用例负责采集就把「失败时的取证」交给最容易在失败时被跳过的那段代码；而 capture 的
 * 创建点在 spec 里、消费点（fixture attach）在测试框架里 —— 一个只读快照是唯一的汇合点。
 *
 * 生命周期 = 一个 worker 进程（playwright 每个 project 一个）。条目只增不减，但一轮的总请求数
 * 是几百条量级，保留全部不会成为内存问题；`stop()` 之后旧条目仍是有效证据。
 */
const captureRegistry: SequencedEnvelope[][] = []
/** entries 数组 → 它监听的 page（waitForEnvelope 的超时上下文要读 URL / 标题 / CAP 状态） */
const capturePage = new WeakMap<CapturedEnvelope[], Page>()
let envelopeSequence = 0

/**
 * 最近 N 条业务响应的**只读快照**（跨本 worker 内所有 capture，按到达顺序取尾部）。
 * 只返回 `url / method / status / code / msg` —— 响应体（`data`）从不采集，自然也不会流出。
 */
export function snapshotRecentEnvelopes(limit = 20): CapturedEnvelope[] {
  return captureRegistry
    .flat()
    .sort((left, right) => left.__seq - right.__seq)
    .slice(-limit)
    .map((entry) => ({
      url: entry.url,
      method: entry.method,
      status: entry.status,
      code: entry.code,
      msg: entry.msg,
    }))
}

/**
 * 采集当前 page 的**业务响应**（同源 `/api/` 的 JSON 响应），返回一个可读数组与停止函数。
 *
 * 只收同源 `/api/`：Sentry / iconify / 字体这类第三方 JSON 也是 `application/json`，
 * 混进来会把「最近 12 条」挤成它们的请求序列 —— 失败上下文对排查毫无用处。判据与
 * `installRealIpRoute` 的同源口径一致（默认 `WEB_ORIGIN + /api/`；WebAuthn 用例的
 * `localhost` origin 通过 `options.origin` 传入）。
 */
export function captureEnvelopes(
  page: Page,
  options: { origin?: string } = {},
): { entries: CapturedEnvelope[]; stop: () => void } {
  const origin = options.origin ?? WEB_ORIGIN
  const entries: SequencedEnvelope[] = []
  captureRegistry.push(entries)
  capturePage.set(entries, page)

  const handler = (response: Response): void => {
    void (async () => {
      try {
        if (!response.url().startsWith(`${origin}/api/`)) {
          return
        }
        const contentType = response.headers()['content-type'] ?? ''
        if (!contentType.includes('application/json')) {
          return
        }
        const body = (await response.json()) as { code?: number; msg?: string }
        entries.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          code: typeof body.code === 'number' ? body.code : undefined,
          msg: body.msg,
          __seq: envelopeSequence++,
        })
      } catch {
        // 响应体已被释放 / 不是 JSON：忽略（采集是辅助断言，不该让用例炸）
      }
    })()
  }

  page.on('response', handler)
  return { entries, stop: () => page.off('response', handler) }
}

/** 错误上下文里最多列多少条 envelope / 由谁决定（超时报错与负对照共用，避免两处文案漂移） */
const ENVELOPE_CONTEXT_LIMIT = 12

/** 把采集数组的尾部格式化成可读上下文（URL / msg 走脱敏：它们可能带 token 查询参数） */
function formatEnvelopes(entries: CapturedEnvelope[], limit = ENVELOPE_CONTEXT_LIMIT): string {
  const recent = entries.slice(-limit)
  if (recent.length === 0) {
    return '最近业务响应：<一条都没有采集到 —— captureEnvelopes 是否挂在当前 page 上？>'
  }
  const lines = recent.map((entry) => {
    const code = entry.code === undefined ? '' : ` code=${entry.code}`
    const msg = entry.msg === undefined ? '' : ` msg=${redactText(entry.msg)}`
    return `${entry.method} ${redactText(entry.url)} status=${entry.status}${code}${msg}`
  })
  return `最近 ${lines.length} 条业务响应：\n${lines.join('\n')}`
}

/**
 * 失败现场的页面状态：URL、标题、CAP widget 状态、localStorage 设备 id。
 *
 * 全部**尽力而为**：page 已关闭 / 导航中 / 选择器超时都只让对应那一行退化成「不可读」，
 * 绝不让「收集上下文」本身抛错盖掉真正的失败。
 */
async function describePageState(page: Page): Promise<string[]> {
  const lines = [`当前 URL=${redactText(page.url())}`]

  try {
    lines.push(`页面标题=${JSON.stringify(redactText(await page.title()))}`)
  } catch {
    lines.push('页面标题=<不可读（页面已关闭 / 上下文被销毁）>')
  }

  try {
    const widget = page.locator(CAP_WIDGET_SELECTOR).first()
    const count = await widget.count()
    let state = '不在 DOM'
    if (count > 0) {
      state = (await widget.isVisible()) ? '可见（尚未解出）' : '在 DOM 但不可见'
    }
    lines.push(`cap-widget=${state}`)
  } catch {
    lines.push('cap-widget=<状态不可读（页面已关闭 / 上下文被销毁）>')
  }

  try {
    const deviceId = await readLocalDeviceId(page)
    lines.push(`localStorage 设备 id=${deviceId ?? '<无>'}`)
  } catch {
    lines.push('localStorage 设备 id=<不可读（页面已关闭 / 上下文被销毁）>')
  }

  return lines
}

/** 失败上下文的采集预算：page 卡死 / 上下文销毁时别让「取证」本身把用例挂到全局超时 */
const CONTEXT_COLLECT_BUDGET_MS = 5_000

/**
 * 带预算的页面状态采集。`page.title()` / `locator.count()` 在渲染进程卡死时没有自己的超时
 * （Playwright 的 action 超时对 evaluate 类调用是 0），所以整段套一层墙钟上限。
 */
async function describePageStateWithinBudget(page: Page): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      describePageState(page),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(resolve, CONTEXT_COLLECT_BUDGET_MS, [
          `页面状态=<采集超时（${CONTEXT_COLLECT_BUDGET_MS / 1000}s），已跳过>`,
        ])
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/** 失败上下文（页面状态 + 可选的一组 envelope）；导出以便其它等待点复用同一份文案 */
export async function describeFailureContext(
  page: Page,
  entries?: CapturedEnvelope[],
): Promise<string> {
  const lines = await describePageStateWithinBudget(page)
  if (entries !== undefined) {
    lines.push(formatEnvelopes(entries))
  }
  return lines.join('\n')
}

/**
 * 等某个条件在采集数组里出现（轮询，避免依赖响应到达顺序）。
 *
 * `fromIndex` 是游标：只匹配 `index >= fromIndex` 的条目，供调用方跳过已经消费过的响应
 * （典型场景：同一被拒 URL 先吃 40116、解完 CAP 再等 40101，不能又匹配到同一批里的旧 40116）。
 */
export async function waitForEnvelope(
  entries: CapturedEnvelope[],
  predicate: (entry: CapturedEnvelope) => boolean,
  timeoutMs = 30_000,
  fromIndex = 0,
): Promise<CapturedEnvelope> {
  const started = Date.now()
  for (;;) {
    const hit = entries.find((entry, index) => index >= fromIndex && predicate(entry))
    if (hit !== undefined) {
      return hit
    }
    if (Date.now() - started > timeoutMs) {
      // 文案用**实际**传入的超时（曾经硬编码 30s，改成 40s 的调用点报错里还在说 30s）。
      // 带上页面状态：超时最常见的原因是「URL / 设备 / CAP 状态与预期不同」，只看 envelope
      // 列表看不出这几件事。
      const page = capturePage.get(entries)
      const context =
        page === undefined ? formatEnvelopes(entries) : await describeFailureContext(page, entries)
      throw new Error(`[e2e/ui] ${Math.round(timeoutMs / 1000)}s 内没等到目标响应；\n${context}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * 等 40605 自愈的**最终**结果：被拒 URL 先穿过 CAP（40116），解掉之后落到 40101（访问令牌已过期）。
 *
 * 为什么最终是 40101 而不是 20000：自愈会签发**全新设备**，而登录会话按设备绑定 ——
 * AT 的会话键是 `AUTH:SESSIONS:<userId>:<deviceId>:<sid>`（`jwt-access.strategy.ts`），
 * RT 行也按 `deviceId` 校验（`refresh.shared.service.ts` 的 `getNewAccessToken`）。换设备后
 * 旧 AT 必然 40101、旧 RT 续期必然 40102，应用按设计 `Signout` 回 `/auth`。硬等 40101 把
 * 「重放穿过 CAP」与「旧会话按设计失效」分成两条判据：任何 40605 复发、CAP 残留或 20000
 * 的假成功都会红，而不是被 `code !== 40605` 这类宽判据吃掉。
 *
 * 为什么禁止再用 `waitForLoadState('networkidle')`：它没传超时，而 `@playwright/test` 运行器把
 * 导航超时强制成 0（`navigationTimeout || 0`）⇒ 只能挂到用例 120s 超时；networkidle 本身也被
 * 官方标注 DISCOURAGED —— stage 构建开着 Sentry tracesSampleRate 1.0 + replay、socket.io 长连接、
 * CAP 弹窗懒加载的 widget 脚本，任何在途请求都会让它永不触发。
 *
 * 为什么必须硬等 40116 并解 CAP、不能把它当成功：自愈产生的新设备带 `DEVICE_NEW`（未处理的
 * critical 风险因子）⇒ 重放的业务请求先吃 40116（要求 CAP 交互）。40116 不是自愈失败，而是
 * 「还需要把 CAP 解掉」；服务端按 `deviceId + token 指纹` 缓存 20 分钟，解一次后同批重放全部放行。
 *
 * `E2E_SKIP_CAP_SOLVE=1` 仅供**负对照**（验证失败是否快速、可读），生产用例不得设置。
 */
export async function waitForDeviceHealSettled(
  page: Page,
  entries: CapturedEnvelope[],
  replayUrl: string,
  options: { timeoutMs?: number; maxCapRounds?: number; skipCapSolve?: boolean } = {},
): Promise<{ capSolved: boolean }> {
  const timeoutMs = options.timeoutMs ?? 40_000
  const maxCapRounds = options.maxCapRounds ?? 2
  const skipCapSolve = options.skipCapSolve ?? process.env.E2E_SKIP_CAP_SOLVE === '1'
  let capSolved = false
  let cursor = 0

  for (let round = 0; round < maxCapRounds; round += 1) {
    const entry = await waitForEnvelope(
      entries,
      (candidate) =>
        candidate.url === replayUrl &&
        (candidate.code === WalnutAdminConstAppResponseCode.SUCCESS ||
          candidate.code ===
            WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED ||
          candidate.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED),
      timeoutMs,
      cursor,
    )
    if (entry.code !== WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED) {
      // 20000 = 会话仍有效（严格契约下不应出现，续期/URL 判据会红）；
      // 40101 = 换设备后旧会话按设计失效。没弹过 CAP 时 capSolved=false，
      // 由用例的硬断言给出「风险配置被改坏」的明确失败，而不是干等 40s。
      return { capSolved }
    }

    // 走到这里只可能是 40116：这是 CAP 交互要求，不是自愈失败
    if (skipCapSolve) {
      throw new Error(
        `[e2e/ui] 重放 ${replayUrl} 只等到 40116（CAP 交互要求），且 E2E_SKIP_CAP_SOLVE=1 已跳过求解` +
          `（负对照开关，生产用例不得设置）。\n${await describeFailureContext(page, entries)}`,
      )
    }

    const solved = await solveCapIfPresent(page, { timeoutMs: 60_000, appearTimeoutMs: 15_000 })
    if (!solved) {
      throw new Error(
        '[e2e/ui] 重放吃到 40116（CAP 交互要求），但 15s 内没出现可点的 cap-widget' +
          ` —— 风险配置或 CAP 组件被改坏了。\n${await describeFailureContext(page, entries)}`,
      )
    }
    capSolved = true

    // 同一批兄弟请求共用一枚 CAP token：解一次后，已记录的 40116 全部视为已消费。
    // 游标推到**最后一条已记录的 40116 之后**（而不是本次命中的那条之后）：既不会被旧 40116
    // 再骗一轮，也不会跳过解 CAP 期间已经到达的后续响应。
    cursor = entries.reduce(
      (last, candidate, index) =>
        candidate.url === replayUrl &&
        candidate.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED
          ? index + 1
          : last,
      cursor,
    )
  }

  // 解完 CAP 后，被拒 URL 的最终业务码必须是 40101（新设备没有旧设备的会话键）。
  // 等不到就让 waitForEnvelope 自然抛错（带末 12 条上下文）。
  await waitForEnvelope(
    entries,
    (candidate) =>
      candidate.url === replayUrl &&
      candidate.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED,
    timeoutMs,
    cursor,
  )
  return { capSolved }
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
      const parsed = JSON.parse(raw) as { v?: unknown; json?: { v?: unknown } }
      const value = parsed.json?.v ?? parsed.v
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }, DEVICE_LOCAL_STORAGE_KEY)
}

/** context 里的 DEVICE_ID cookie（stage 形态无前缀；值带 `s:` 签名，原样返回） */
export async function readDeviceCookie(context: BrowserContext): Promise<{
  value: string
  secure: boolean
  httpOnly: boolean
  path: string
  expires: number
  domain: string
} | null> {
  const cookies = await context.cookies()
  const cookie = cookies.find((item) => item.name === DEVICE_COOKIE_NAME)
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
function currentTotp(secret: string): string {
  return generateSync({ secret })
}

/**
 * `solveCapIfPresent` 的选项。`budget` 存在时，三步（出现 / 点击 / 消失）都取
 * `min(本步上限, 链路剩余)` —— CAP 是登录链路里最不可控的一段（WASM 拉取 + PoW），
 * 不给它单独拖到全局超时的机会。`budgetLabel` 只进报错文案（点名是哪次 CAP）。
 */
export interface CapSolveOptions {
  timeoutMs?: number
  appearTimeoutMs?: number
  clickTimeoutMs?: number
  budget?: WaitBudget
  budgetLabel?: string
}

/**
 * 断言 cap-widget 出现（U13 的 post-auth CAP 重武装：「CAP 对话框可见」）。
 * 只等可见、不点击 —— 求解由 {@link solveCapWidget} 单独做，两步分开后失败定位更清楚。
 */
export async function waitForCapWidget(page: Page, timeoutMs = 15_000): Promise<void> {
  await expect(page.locator(CAP_WIDGET_SELECTOR).first()).toBeVisible({ timeout: timeoutMs })
}

/**
 * 若 cap-widget 出现则点它并等它消失；返回是否真的解过。
 *
 * 导出给 U13 的「断言可见 → 求解 → 等重放成功」三段式用；登录链路内部仍直接调
 * {@link solveCapIfPresent}，不经过这层包装（那一步允许 widget 不出现）。
 */
export async function solveCapWidget(page: Page, options: CapSolveOptions = {}): Promise<boolean> {
  return solveCapIfPresent(page, options)
}

/**
 * 登录提交后的 CAP 等待：**竞速**（离开 `/auth` vs widget 可见），不再盲等固定窗口。
 *
 * 为什么改：登录提交后只有两种可能 —— 请求成功（去 MFA / 落地）或登录链吃到 40116
 * （拦截器弹 cap-widget 并重放，此时 URL 仍停在 `/auth`）。旧实现无条件等 widget 10s，
 * 而 12/12 次 UI 登录里 widget 都没出现，纯空等 122.5s（R-C 实测）。竞速以「URL 已离开
 * `/auth`」为**正向证据**，不需要 CAP 的情况下立即继续；需要 CAP 时 widget 先出现，
 * 仍走完整的点击 + 等消失（timeoutMs 60s 不变）。
 *
 * 判据不减：竞速后保留 {@link LOGIN_CAP_GRACE_MS} 的短窗口兜住「导航后才落地的请求吃 40116」
 * 的晚到形态（旧实现用 10s 窗口兜它）；窗口内出现 widget 仍求解，不会因为「先导航了」就跳过。
 * 两者都没发生 ⇒ 明确报「登录链路卡住」，而不是继续往下走（负对照的判据就在这里）。
 *
 * 两个 promise 都必须各自 `catch`：输掉竞速的那个稍后 reject 会变成 unhandled rejection，
 * 把整轮 run 弄脏（Node 24 直接报警）。
 */
const LOGIN_CAP_APPEAR_MS = 15_000
const LOGIN_CAP_GRACE_MS = 2_000

export async function settlePostLoginCap(
  page: Page,
  options: { budget?: WaitBudget; budgetLabel?: string } = {},
): Promise<boolean> {
  const label = options.budgetLabel ?? '登录后 CAP'
  const appearTimeout =
    options.budget === undefined
      ? LOGIN_CAP_APPEAR_MS
      : stepTimeout(options.budget, `${label}出现`, LOGIN_CAP_APPEAR_MS)

  const widget = page.locator(CAP_WIDGET_SELECTOR).first()
  const outcome = await Promise.race([
    page
      .waitForURL((url) => url.pathname !== '/auth', { timeout: appearTimeout })
      .then(() => 'nav' as const)
      .catch(() => 'timeout' as const),
    widget
      .waitFor({ state: 'visible', timeout: appearTimeout })
      .then(() => 'cap' as const)
      .catch(() => 'timeout' as const),
  ])

  if (outcome === 'timeout') {
    throw new Error(
      `[e2e/ui] 登录提交后 ${Math.round(appearTimeout / 1000)}s 内既没有离开 /auth 也没有出现 CAP` +
        ' —— 登录链路卡住（不当作「不需要 CAP」继续）',
    )
  }

  if (outcome === 'cap') {
    return await solveCapWidget(page, {
      timeoutMs: 60_000,
      budget: options.budget,
      budgetLabel: label,
    })
  }

  // 导航先到：保留短窗口兜「晚到 40116」。widget 没出现就是 false（与旧实现同返回值语义）。
  return await solveCapIfPresent(page, {
    timeoutMs: 60_000,
    appearTimeoutMs: LOGIN_CAP_GRACE_MS,
    budget: options.budget,
    budgetLabel: label,
  })
}

/**
 * 若 cap-widget 出现则点它并等它消失。
 *
 * cap.js 的 standalone widget 是一个需要在 shadow DOM 里点一下的复选框；点完它自己做 PoW
 * （WASM 由 admin 同源自托管在 `public/vendor/cap/`）并发出 `solve` 事件，拦截器随后重放原请求、
 * 组件 1s 后关闭 modal。
 *
 * **不直接导出**：解 CAP 的消费方是 {@link waitForDeviceHealSettled}（以及本文件的登录动作），
 * 外部只能经 {@link solveCapWidget} 调用 —— 直接内联点击容易在「40116 属于 CAP 交互要求」
 * 这条判据上分叉。
 */
async function solveCapIfPresent(page: Page, options: CapSolveOptions = {}): Promise<boolean> {
  const label = options.budgetLabel ?? 'CAP'
  // 每一步都**重新**取剩余预算：一次性算三步会把「出现 + 点击 + 消失」各按剩余额度下发，
  // 合计最多能超出链路预算一倍（例如剩 10s 时三步各给 10s）。CAP 是链路里最不可控的一段，
  // 必须在每个子步骤前再判一次耗尽。
  const limit = (step: string, capMs: number): number =>
    options.budget === undefined ? capMs : stepTimeout(options.budget, step, capMs)

  const widget = page.locator(CAP_WIDGET_SELECTOR).first()

  try {
    await widget.waitFor({
      state: 'visible',
      timeout: limit(`${label}出现`, options.appearTimeoutMs ?? 6_000),
    })
  } catch {
    return false
  }

  // Playwright 的默认 action 超时是 0（跟随用例超时）：被任何 overlay 挡住都会挂到 120s。
  // 这里给点击单独设上限 —— 挡住的现场应以「intercepts pointer events」快速报错，而不是挂死。
  await widget.click({ timeout: limit(`${label}点击`, options.clickTimeoutMs ?? 30_000) })
  await widget.waitFor({
    state: 'hidden',
    timeout: limit(`${label}消失`, options.timeoutMs ?? 60_000),
  })
  return true
}

/**
 * 过 MFA 验证页（`/mfa-verified`）：点唯一启用中的方法卡 → 输入 TOTP → 回车。
 * 页面没出现则直接返回 false（未绑定 / 设备已 trusted 的路径）。
 *
 * `budget` 只用来收窄本段每一步的超时；MFA 不在登录链路上（例如单独验证页）时可不传。
 */
export async function verifyMfaIfPresent(
  page: Page,
  totpSecret: string,
  budget?: WaitBudget,
): Promise<boolean> {
  const limit = (step: string, capMs: number): number =>
    budget === undefined ? capMs : stepTimeout(budget, step, capMs)

  try {
    await page.waitForURL((url) => url.pathname === '/mfa-verified', {
      timeout: limit('MFA 页面出现', 8_000),
    })
  } catch {
    return false
  }

  // 只有 TOTP 一个方法启用（WebAuthn 未绑定）⇒ 可见卡片唯一。
  // 必须加 :visible —— 登录页的卡片仍挂在 DOM 里（懒卸载），裸 .first() 会点到隐藏的那个。
  await page
    .locator(MFA_METHOD_CARD_SELECTOR)
    .first()
    .click({ timeout: limit('MFA 方法卡点击', 10_000) })
  const input = page.locator(MFA_CODE_INPUT_SELECTOR).first()
  await input.waitFor({ state: 'visible', timeout: limit('MFA 输入框出现', 10_000) })
  await input.fill(currentTotp(totpSecret), { timeout: limit('MFA 输入', 10_000) })
  await input.press('Enter', { timeout: limit('MFA 提交', 10_000) })

  // 验证通过后 ExecuteCoreFnAfterAuth 会 goIndex → 离开 /mfa-verified
  await page.waitForURL((url) => url.pathname !== '/mfa-verified', {
    timeout: limit('MFA 验证落地', 20_000),
  })
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
 *
 * 失败时**不只抛「等不到」**：包装层把当前 URL、标题、CAP widget 状态、localStorage 设备 id
 * 与最近 12 条业务响应拼进错误消息（原始错误挂在 `cause` 上，栈不变）。这些信息同时进
 * junit 的 failure message —— 裸 runner / CI 上排障不必再登录机器复现。
 */
/**
 * 登录链路失败时的统一包装：把 P1-3 的失败现场（URL / 标题 / CAP widget / 设备 id /
 * 最近 12 条 envelope）拼进错误消息，原始错误挂 `cause`（栈不变）。`stage` 只用于标注
 * 是哪一段（当前只有 `loginViaUI`）。
 */
async function withLoginFailureContext(page: Page, error: unknown, stage: string): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error)
  const context = await describeFailureContext(
    page,
    snapshotRecentEnvelopes(ENVELOPE_CONTEXT_LIMIT),
  ).catch(() => '（失败现场不可读：页面已在关闭过程中）')
  return new Error(`${message}\n[e2e/ui] 登录失败现场（${stage}）：\n${context}`, { cause: error })
}

export async function loginViaUI(
  page: Page,
  options: { userName?: string; password?: string; totpSecret?: string } = {},
): Promise<LoginResult> {
  return runLoginChain(page, options, startWaitBudget(LOGIN_TOTAL_BUDGET_MS))
}

/**
 * 登录链路的统一收口：`budget` 从**链路起点**开始计时（`loginViaUI` 在打开 `/auth` 之前
 * 建立，整条「打开 → CAP → 竞速 → 登录」共用一份 90s，而不是每段各给一份）。
 */
async function runLoginChain(
  page: Page,
  options: { userName?: string; password?: string; totpSecret?: string },
  budget: WaitBudget,
): Promise<LoginResult> {
  try {
    return await performLogin(page, options, budget)
  } catch (error) {
    throw await withLoginFailureContext(page, error, 'loginViaUI')
  }
}

async function performLogin(
  page: Page,
  options: { userName?: string; password?: string; totpSecret?: string },
  budget: WaitBudget,
): Promise<LoginResult> {
  const credentials =
    options.userName !== undefined
      ? {
          userName: options.userName,
          password: options.password ?? '',
          totpSecret: options.totpSecret ?? '',
        }
      : readCredentials()

  await page.goto('/auth', { timeout: stepTimeout(budget, '打开登录页', 30_000) })

  // 登录后 default layout 会延迟 1.5s 启动 driver.js 引导；它的全屏 overlay 会拦截 cap-widget
  // 的点击（自愈后的 40116 就发生在 layout 里）。登录页还没有 default layout，在导航之后、
  // layout 挂载之前预置最稳 —— 别等 overlay 出现后再关，`allowClose: false` 根本没有关闭入口。
  //
  // cookie 的 url 取**当前页面 origin**（而不是固定 WEB_ORIGIN）：WebAuthn 用例跑在
  // `http://localhost:<port>`（Chrome 不接受 IP 作 RP ID，见 env.ts 的 WEBAUTHN_WEB_ORIGIN），
  // 固定 127.0.0.1 会让那枚 cookie 落不到该 context 的域上。
  await markAppIntroSeen(page)

  // 启动序列里就有请求可能被判「需要人机交互」（新设备的 DEVICE_NEW critical 因子）——
  // CAP 是 **WModal + 全屏 mask**，不先解掉它，登录表单点不动（fill 也会被焦点陷阱吞掉）。
  const capAfterBoot = await solveCapIfPresent(page, { budget, budgetLabel: '启动 CAP' })

  const userNameInput = page.locator(LOGIN_USERNAME_SELECTOR).first()
  await userNameInput.waitFor({
    state: 'visible',
    timeout: stepTimeout(budget, '登录表单出现', 30_000),
  })
  await userNameInput.fill(credentials.userName, {
    timeout: stepTimeout(budget, '填用户名', 15_000),
  })

  const passwordInput = page.locator(LOGIN_PASSWORD_SELECTOR).first()
  await passwordInput.fill(credentials.password, { timeout: stepTimeout(budget, '填密码', 15_000) })
  // Extra:Password 在 Enter 上触发 submit（比找按钮稳：按钮文案来自 DB 语言包）
  await passwordInput.press('Enter', { timeout: stepTimeout(budget, '提交登录', 15_000) })

  // R-C O1：竞速替代 10s 盲等（见 settlePostLoginCap 头注释）；需要 CAP 时判据不变。
  const capAfterLogin = await settlePostLoginCap(page, { budget })
  const capSolved = capAfterBoot || capAfterLogin
  const mfaVerified = await verifyMfaIfPresent(page, credentials.totpSecret, budget)

  // 登录成功的判据：离开 /auth 与 /mfa-verified，并出现应用外壳（侧边栏菜单）
  await page.waitForURL((url) => url.pathname !== '/auth' && url.pathname !== '/mfa-verified', {
    timeout: stepTimeout(budget, '登录落地', 40_000),
  })
  await page
    .locator(SIDEBAR_MENU_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: stepTimeout(budget, '应用外壳出现', 30_000) })

  return { capSolved, mfaVerified, url: page.url() }
}

/** 断言侧边栏至少渲染出一个菜单项（menus 来自 /auth/permissions 的真实数据） */
export async function expectSidebarRendered(page: Page): Promise<void> {
  const items = page.locator(SIDEBAR_MENU_ITEM_SELECTOR).first()
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

/** 路由解析 / 组件挂载的等待上限：菜单路由都是本地异步 chunk，15s 足够慢环境加载 */
const NAVIGATE_ROUTE_TIMEOUT_MS = 15_000

/**
 * 应用内导航到目标路由，并等**上一页真正离场**（E4 的 `reachability.spec.ts` 起于此，
 * E5' 的其他旅程复用 —— 新页面导航一律走它，别手写 `navigateInApp` + `waitForURL`）。
 *
 * 为什么需要等离场：布局的 `WTransition` 是 `mode="out-in"`，导航后旧页面会先播 ~300ms
 * 离场动画（`v-leave-to`），**这段时间旧 DOM 仍挂在内容容器里**。实测 `/demo/table/base`
 * （菜单 component 解析成 undefined）会被上一页 `/home` 的残留卡片骗过 —— 「内容有元素子节点」
 * 看起来成立。这里给旧根打一个临时标记，等它从 DOM 消失后再判新页；空组件路由此时容器为空，
 * 挂载断言才会红。
 *
 * 同路径不触发过渡（首次进入 `/home` 就已在 `/home`），直接复用当前已挂载的页面。
 */
export async function navigateToRoute(
  page: Page,
  path: string,
  routeName: string,
  timeoutMs = NAVIGATE_ROUTE_TIMEOUT_MS,
): Promise<void> {
  if (new URL(page.url()).pathname !== path) {
    await page.evaluate(() => {
      document
        .querySelectorAll('[data-e2e-stale-root]')
        .forEach((el) => el.removeAttribute('data-e2e-stale-root'))
      const content = document.querySelector('[id$="-content"]')
      content?.firstElementChild?.setAttribute('data-e2e-stale-root', '')
    })

    await navigateInApp(page, path)
    await page.waitForURL((url) => url.pathname === path, { timeout: timeoutMs })

    await expect(
      page.locator('[data-e2e-stale-root]'),
      `${path} 导航后上一页组件没有离场（transition 未完成）`,
    ).toHaveCount(0, { timeout: timeoutMs })
  }

  await page.waitForURL((url) => url.pathname === path, { timeout: timeoutMs })
  await expect(
    page.locator(`#${routeName}-content`),
    `${path} 没有内容容器 #${routeName}-content（路由 name 与菜单 name 不一致？）`,
  ).toBeVisible({ timeout: timeoutMs })
}
