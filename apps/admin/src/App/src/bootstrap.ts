import type { App } from 'vue'
import { removeStorageItemsContaining } from '@walnut/client/persistent/shared'
import { AppConstPersistKey } from '@/const/persistent'
import { installI18n, loadLocaleMessages } from '@/locales'
import { setupRouter } from '@/router'
import { setupStore } from '@/store/pinia'
import { isDev } from '@/utils/constant/vue'
import { reportRuntimeFatal } from './runtime-error'
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
 * 现在的判据分**三档**（2026-10-08 起；分档标准 = **失败后用户还能不能用**，不看步骤名）：
 *
 * - **`blocking`（阻断）**：没它就不能进页面。失败 ⇒ **不 mount**，把 splash 换成一屏
 *   **能读懂的错误**（`renderBootstrapFailure`），控制台另有完整堆栈。
 *   除了 store / i18n 壳 / router，**`sign` 也在这一档**：签名是请求拦截器里做的
 *   （`utils/axios/interceptors/request/interceptor.ts` 对**每个**请求 `await` 签名），
 *   密钥拿不到 ⇒ 之后每一个请求都是坏的 ⇒ 页面等于打不开。2026-10-08 实测：空库时
 *   `/security/sign/aes-key` 返回 50000、密钥为空、页面白屏——根因就是这一步被当成
 *   「可降级」放行了。
 * - **`degraded`（降级）**：失败照常进页面，但**必须让人看见**（`reportBootstrapProblems`
 *   + 挂载后的全局提示）。判据：不影响「请求能不能发出去」，只影响信息完整度——
 *   语言包拿不到就显 key；设备指纹 / 设备注册拿不到只是少一个风控标识
 *   （它们不在每请求的必需头里：`AppConstRequestHeaders` 只有 AUTHORIZATION / LANGUAGE /
 *   FINGERPRINT / SIGN / TIMESTAMP / NONCE，且指纹头的构造只读 store、不会抛）。
 * - **`optional`（可选）**：纯观测 / 第三方，失败只 `console` 一条，用户无感。
 *
 * **「请求会不会坏」是分档唯一的硬标准**：签名（每请求必需，缺了必坏）⇒ blocking；
 * 设备 / 指纹（头里可空、构造不抛）⇒ degraded；统计类 ⇒ optional。
 * 网络类步骤额外加超时兜底（`STEP_TIMEOUT_MS`）：请求挂死时 `await` 永不 resolve，
 * 那是「无限 splash」的另一种成因，光靠 try/catch 拦不住。
 */

/** 单个网络类步骤的超时兜底；到点按「这一步失败」处理，绝不无限等 */
export const STEP_TIMEOUT_MS = 20_000

/** 步骤分级；缺省按 `degraded` 处理——忘了标也不会静默吞掉 */
export type BootstrapStepLevel = 'blocking' | 'degraded' | 'optional'

export interface BootstrapProblem {
  /** 步骤名（表里的 `name`），报错与提示都用它 */
  step: string
  /** 该步的分级；调用方据此决定「错误屏」还是「提示」 */
  level: BootstrapStepLevel
  error: unknown
}

export interface BootstrapResult {
  /** `blocking` 步失败：没它就不能进页面（调用方**不要** mount） */
  fatal?: BootstrapProblem
  /** `degraded` / `optional` 步失败：照常进页面，但降级必须提示 */
  problems: BootstrapProblem[]
}

interface BootstrapStep {
  name: string
  /** 分级（见文件顶部说明）；缺省按 `degraded` */
  level?: BootstrapStepLevel
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
 * 顺序是刻意保留的（与拆分前一致）：设备/指纹/签名要在 i18n 与 router 之前就绪，否则路由组件一
 * 挂载就会发出没有签名、没有设备标识的请求。想调整顺序请先想清楚这件事。
 */
export async function bootstrapApp(app: App): Promise<BootstrapResult> {
  const problems: BootstrapProblem[] = []
  let router: ReturnType<typeof setupRouter> | undefined

  const steps: BootstrapStep[] = [
    { name: 'store', level: 'blocking', run: () => setupStore(app) },
    { name: 'google-signin', level: 'optional', run: () => setupGoogleSignIn(app) },
    { name: 'analytics', level: 'optional', timeout: true, run: setupAnalytics },
    { name: 'fingerprint', level: 'degraded', timeout: true, run: setupFingerprint },
    { name: 'device-id', level: 'degraded', timeout: true, run: setupDeviceId },
    { name: 'sign', level: 'blocking', timeout: true, run: setupSign },
    { name: 'i18n', level: 'blocking', run: () => installI18n(app) },
    { name: 'locale-messages', level: 'degraded', timeout: true, run: loadLocaleMessages },
    {
      name: 'router',
      level: 'blocking',
      run: () => {
        router = setupRouter(app)
        // 懒加载 chunk 拉不到时 vue-router 会走到这里（典型场景：发版后浏览器还持有旧页面，
        // 旧 HTML 去要已被替换掉的 chunk 名）。它发生在**导航时**、也就是挂载之后，
        // 所以交给运行时覆盖层，而不是启动错误屏（那时 mount 早就完成了）。
        router.onError((error) => {
          reportRuntimeFatal(error, 'router.onError（页面资源加载失败；多半是刚发版、刷新即可）')
        })
      },
    },
    { name: 'sentry', level: 'optional', run: () => setupSentry(app, router!) },
  ]

  for (const step of steps) {
    try {
      await (step.timeout === true ? withTimeout(step.name, step.run) : step.run())
    }
    catch (error) {
      const level = step.level ?? 'degraded'
      const problem: BootstrapProblem = { step: step.name, level, error }
      if (level === 'blocking')
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
  // 稳定标记：给冒烟/端到端断言用（`pnpm smoke:dist` 的负对照要判「错误屏出现了、页面不是空白」）。
  // 值就是失败的步骤名，排障时从 DOM 上直接能读出来是哪一步挂的。
  wrap.setAttribute('data-walnut-error-screen', problem.step)
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

  // P0（2026-11）：sign 是 blocking 步骤，但有一类失败**刷新治不好** —— 服务端丢了
  // 「客户端 RSA 公钥」（Redis flush / 驱逐 / 无持久化重启）而本机还留着 30 天密钥对时，
  // setupSign 只在「本地没有密钥对」时才登记（store/modules/app/app-security.ts:114-122），
  // 于是永远不补登记：每次启动都红在这一步，点「重新加载」只是把同一幕重演一遍。
  // 这里给一个只清本机密钥对的入口 —— 清掉后 setupSign 会重新生成并登记。
  // （不碰 store：本函数刻意保持纯 DOM，见上方注释；这里只复用 @walnut/client 的存储工具。）
  if (problem.step === 'sign') {
    const resetKeys = document.createElement('button')
    resetKeys.textContent = '重置本机密钥并重试'
    resetKeys.setAttribute('data-walnut-error-action', 'reset-rsa-keys')
    resetKeys.setAttribute('style', 'padding:8px 20px;border:1px solid #4a4a4a;border-radius:6px;background:transparent;color:#f0f0f0;cursor:pointer;')
    resetKeys.addEventListener('click', () => {
      const removed = [
        ...removeStorageItemsContaining(localStorage, AppConstPersistKey.RSA_PUBLIC_KEY),
        ...removeStorageItemsContaining(localStorage, AppConstPersistKey.RSA_PRIVATE_KEY),
      ]
      console.info('[bootstrap] 已清除本机 RSA 密钥对，下一次启动会重新生成并登记', removed)
      location.reload()
    })

    const resetHint = document.createElement('div')
    resetHint.setAttribute('style', 'max-width:min(760px,90vw);opacity:.6;font-size:12px;')
    resetHint.textContent = '「重置本机密钥」只清本机保存的 RSA 密钥对（不动其它数据）。'
      + '若服务端 Redis 被清空过（公钥登记丢了），这一步通常就能恢复。'

    wrap.append(resetKeys, resetHint)
  }

  host.replaceChildren(wrap)
}

/**
 * 启动问题上报。**按档位呈现**（2026-10-08 起）：
 *
 * - `degraded`：影响用户能感知到的完整度（语言包、设备标识…）⇒ 除控制台外**再弹一条提示**，
 *   让人知道「应用起来了但少了东西」，而不是自己犯嘀咕「怎么有点不对」。
 * - `optional`：纯观测 / 第三方（统计、Sentry…）⇒ **只进控制台**，不打扰用户。
 *
 * 两类都逐条 `console.error`，排障时一眼能看出是哪一步失败的。
 */
export function reportBootstrapProblems(problems: readonly BootstrapProblem[]): void {
  if (problems.length === 0)
    return

  for (const problem of problems)
    console.error(`[bootstrap] 启动步骤失败（${problem.level}）：${problem.step}`, problem.error)

  const degraded = problems.filter(p => p.level === 'degraded')
  const optional = problems.filter(p => p.level === 'optional')
  const names = problems.map(p => p.step).join('、')
  console.warn(
    `[bootstrap] ${problems.length} 个步骤失败（degraded ${degraded.length} / optional ${optional.length}），`
    + `应用继续启动：${names}`,
  )

  // 只有 degraded 才弹提示：它影响用户能感知到的完整度；optional 失败用户本就无感，弹了只是噪音。
  if (degraded.length === 0)
    return

  // naive-ui 的 provider 在 App.vue 里 ⇒ mount 之后才有 window.$message（见 types/window.d.ts）
  window.$message?.warning(
    `启动时有 ${degraded.length} 个步骤失败（${degraded.map(p => p.step).join('、')}），详情见控制台`,
    { duration: 8000 },
  )
}
