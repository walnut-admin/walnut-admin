import type { App } from 'vue'
import { installI18n, loadLocaleMessages } from '@/locales'
import { setupRouter } from '@/router'
import { setupStore } from '@/store/pinia'
import { isDev } from '@/utils/constant/vue'
import { setupAnalytics, setupDeviceId, setupFingerprint, setupSign } from './scripts'
import { setupGoogleSignIn } from './scripts/google-signin'
import { setupSentry } from './scripts/sentry'

/**
 * 组合根（composition root）：把「进页面之前要做的那些事」从 `main.ts` 里收进来，并且**逐步隔离**。
 *
 * ## 为什么必须逐步隔离（2026-09-29，留档 V4）
 *
 * 原先 `main.ts` 是 `await setupApp(app)` 再 `app.mount('#app')`：整条链上**任何一步抛出**（后端没起、
 * 库是空的、某个请求 500…）都会让 `mount` 永不执行 —— 用户只看到 `index.html` 里那屏 loading，
 * 原因只在控制台。这正是 2026-09-24 登记在 `architecture-todo.md` 的「前端启动序列没有容错」，
 * 也是「移除 auto-import」那次被误判成「插件不生效」的真凶。
 *
 * 现在的判据分两类：
 *
 * - **关键步（`critical`）**：没它就不能进页面（store / i18n 壳 / router）。失败 ⇒ **不 mount**，
 *   直接把 splash 换成一屏**能读懂的错误**（`renderBootstrapFailure`），控制台另有完整堆栈。
 * - **可降级步**：失败只记下来，照常进页面，mount 之后弹一条 warning + 控制台逐条打
 *   （`reportBootstrapProblems`）。**宁可降级也不要静默空转**：语言包拿不到就显出 key，
 *   设备/签名没就绪就早失败，都比「一屏 loading 到底」可诊断。
 *
 * 网络类步骤额外加超时兜底（`STEP_TIMEOUT_MS`）：请求挂死时 `await` 永不 resolve，
 * 那是「无限 splash」的另一种成因，光靠 try/catch 拦不住。
 */

/** 单个网络类步骤的超时兜底；到点按「这一步失败」处理，绝不无限等 */
export const STEP_TIMEOUT_MS = 20_000

export interface BootstrapProblem {
  /** 步骤名（表里的 `name`），报错与提示都用它 */
  step: string
  error: unknown
}

export interface BootstrapResult {
  /** 关键步失败：没它就不能进页面（调用方**不要** mount） */
  fatal?: BootstrapProblem
  /** 可降级步失败：照常进页面，但必须提示 */
  problems: BootstrapProblem[]
}

interface BootstrapStep {
  name: string
  /** 关键步：失败则不再继续，直接返回 fatal */
  critical?: boolean
  /** 网络类步骤：加超时兜底 */
  timeout?: boolean
  run: () => void | Promise<void>
}

/** 给一步套上超时（到点抛错，由调用方记为「这一步失败」） */
async function withTimeout(name: string, run: () => void | Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`步骤「${name}」超过 ${STEP_TIMEOUT_MS}ms 未完成（已按失败处理，应用继续启动）`)),
          STEP_TIMEOUT_MS,
        )
      }),
    ])
  }
  finally {
    if (timer !== undefined)
      clearTimeout(timer)
  }
}

/**
 * 按序跑启动步骤。**不抛异常** —— 失败都变成返回值，由调用方决定「显示错误屏」还是「降级启动」。
 *
 * ⚠️ 顺序是刻意保留的（与拆分前一致）：设备/指纹/签名要在 i18n 与 router 之前就绪，否则路由组件一
 * 挂载就会发出没有签名、没有设备标识的请求。想调整顺序请先想清楚这件事。
 */
export async function bootstrapApp(app: App): Promise<BootstrapResult> {
  const problems: BootstrapProblem[] = []
  let router: ReturnType<typeof setupRouter> | undefined

  const steps: BootstrapStep[] = [
    { name: 'store', critical: true, run: () => setupStore(app) },
    { name: 'google-signin', run: () => setupGoogleSignIn(app) },
    { name: 'analytics', timeout: true, run: setupAnalytics },
    { name: 'fingerprint', timeout: true, run: setupFingerprint },
    { name: 'device-id', timeout: true, run: setupDeviceId },
    { name: 'sign', timeout: true, run: setupSign },
    { name: 'i18n', critical: true, run: () => installI18n(app) },
    { name: 'locale-messages', timeout: true, run: loadLocaleMessages },
    { name: 'router', critical: true, run: () => { router = setupRouter(app) } },
    { name: 'sentry', run: () => setupSentry(app, router!) },
  ]

  for (const step of steps) {
    try {
      await (step.timeout === true ? withTimeout(step.name, step.run) : step.run())
    }
    catch (error) {
      const problem: BootstrapProblem = { step: step.name, error }
      if (step.critical === true)
        return { fatal: problem, problems }
      problems.push(problem)
    }
  }

  if (isDev())
    app.config.performance = true

  // 这行是「启动序列跑完了」的判据（排障时先看它在不在控制台）
  console.info('setupApp', 'App Initializing...')

  return { problems }
}

/**
 * 关键步失败：**不 mount**，把 splash 换成一屏能读懂的错误。
 *
 * 刻意只用纯 DOM（不碰 Vue）：走到这里说明 app 处于半初始化状态，再指望组件渲染是不可靠的。
 * 也刻意不用 `innerHTML` —— 错误消息来自运行时，字符串拼 HTML 就是给自己开一个注入口子。
 */
export function renderBootstrapFailure(problem: BootstrapProblem): void {
  console.error('[bootstrap] 启动失败（不会 mount，避免半初始化状态）', problem)

  const host = document.getElementById('app')
  if (host === null)
    return

  const wrap = document.createElement('div')
  wrap.setAttribute(
    'style',
    'position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;'
    + 'justify-content:center;padding:32px;background:#161616;color:#f0f0f0;'
    + 'font:14px/1.6 system-ui,-apple-system,sans-serif;text-align:center;',
  )

  const title = document.createElement('div')
  title.textContent = '应用启动失败'
  title.setAttribute('style', 'font-size:22px;font-weight:600;')

  const where = document.createElement('div')
  where.textContent = `失败的步骤：${problem.step}`

  const detail = document.createElement('pre')
  detail.textContent = problem.error instanceof Error ? problem.error.message : String(problem.error)
  detail.setAttribute(
    'style',
    'max-width:min(760px,90vw);max-height:40vh;overflow:auto;margin:0;padding:12px;border-radius:8px;'
    + 'background:#232323;color:#ffb4b4;text-align:left;white-space:pre-wrap;word-break:break-word;',
  )

  const hint = document.createElement('div')
  hint.setAttribute('style', 'max-width:min(760px,90vw);opacity:.75;')
  hint.textContent = '完整堆栈在浏览器控制台。本地最常见的原因：后端没起、或 Mongo 是空库'
    + '（语言包/设备初始化都会拿不到数据）。'

  const retry = document.createElement('button')
  retry.textContent = '重新加载'
  retry.setAttribute('style', 'padding:8px 20px;border:0;border-radius:6px;background:#0065cc;color:#fff;cursor:pointer;')
  retry.addEventListener('click', () => location.reload())

  wrap.append(title, where, detail, hint, retry)
  host.replaceChildren(wrap)
}

/** 可降级步失败：**必须让人看见**（否则用户只感觉到「某些功能不对」） */
export function reportBootstrapProblems(problems: readonly BootstrapProblem[]): void {
  if (problems.length === 0)
    return

  for (const problem of problems)
    console.error(`[bootstrap] 可降级步骤失败：${problem.step}`, problem.error)

  const names = problems.map(p => p.step).join('、')
  console.warn(`[bootstrap] ${problems.length} 个步骤失败，应用以降级状态启动：${names}`)

  // naive-ui 的 provider 在 App.vue 里 ⇒ mount 之后才有 window.$message（见 types/window.d.ts）
  window.$message?.warning(
    `启动时有 ${problems.length} 个步骤失败（${names}），详情见控制台`,
    { duration: 8000 },
  )
}
