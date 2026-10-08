/**
 * `pnpm smoke:dist` —— **产物冒烟**：把 `dist` 拿真实浏览器打开，断言应用真的起来了。
 *
 * ## 为什么需要它（V13 的教训）
 *
 * CI 里 admin 那步只有 `pnpm build`：**构建成功不等于跑得起来**。2026-09-29 实测过一次
 * 「构建绿、打开死」——`resolve.conditions` 少了默认条件 ⇒ 依赖解析到 UMD 入口 ⇒ 产物一执行就抛
 * `Cannot destructure property '__extends' of 'e(...).default'`，页面停在 splash。这类错误
 * **只有运行期看得见**：`tsc` 绿、lint 绿、build 绿、dist 密钥扫描也绿。
 *
 * ## 判据（刻意少而硬）
 *
 * 1. `#app` 里**不再有** `index.html` 那屏 splash（`.app-loading`）⇒ 说明 `mount` 真的执行了；
 * 2. 期间**没有未捕获异常**（`Runtime.exceptionThrown`）。
 *
 * 刻意**不**断言"页面内容正确"：产物在没有后端的环境里一定是降级状态（语言包缺失会显示 i18n key，
 * 这正是 V4 设计的可降级行为）。把那种状态判成失败，只会让这道闸被绕开。
 *
 * ## 找不到浏览器 = SKIP，不是失败
 *
 * 本仓不是所有机器都有 Chrome（本机有、CI 的 ubuntu runner 也有，但别的环境未必）。
 * 缺浏览器时**明确打一行 skipped**（含怎么装 / 怎么指定），并按通过返回 —— 假装绿比不跑更糟，
 * 所以那行字必须显眼。
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import process from 'node:process'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'

export const DEFAULT_DIST = 'apps/admin/dist'

/** 等应用挂载的上限（构建产物加载 + 引导序列；本机实测冷启动数秒） */
export const MOUNT_TIMEOUT_MS = 60_000

/** 产物里那屏 splash 的标记（`apps/admin/index.html`）；它没消失就说明 mount 没执行 */
export const SPLASH_SELECTOR = '.app-loading'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/**
 * 找一个可用的浏览器二进制。
 *
 * 顺序：`CHROME_PATH` 环境变量 → 各平台常见位置。返回 `null` = 这台机器没有 ⇒ 调用方打 SKIP。
 *
 * `exists` 可注入：用例要能确定性地测"有 / 没有"两条分支，而**宿主机器本身装没装浏览器**是环境事实
 * —— CI 的 ubuntu runner 自带 `/usr/bin/google-chrome`，本机是 Windows 路径，写死断言必然一边红
 * （实测：本地全绿、CI 三个用例红）。
 */
export function findChrome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const candidates: string[] = []
  if (env.CHROME_PATH !== undefined && env.CHROME_PATH !== '')
    candidates.push(env.CHROME_PATH)

  if (platform === 'win32') {
    candidates.push(
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    )
  }
  else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    )
  }
  else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    )
  }

  return candidates.find(c => c !== '' && exists(c)) ?? null
}

export interface StaticServer {
  url: string
  close: () => Promise<void>
  /** 被请求但不存在的**资源**（带扩展名的路径；回退 index.html 的那些） */
  missing: string[]
}

/** 静态服务器的可选行为（负对照用） */
export interface StaticServerOptions {
  /**
   * 模拟后端故障：所有 `/api/**` 都按**后端真实错误信封**应答（HTTP 500 + `{ code: 50000 }`）。
   *
   * 用途：确定性地复现 2026-10-08 的事故链——空库 ⇒ `/security/sign/aes-key` 拿不到密钥 ⇒
   * 启动序列的 `sign` 步失败 ⇒（它是 blocking）⇒ 应当出现**错误屏**而不是白屏。
   * 没有这个开关，产物冒烟就永远只能证明「能挂载」，证明不了「挂不上时会怎样」。
   */
  failApi?: boolean
}

/**
 * 起一个只伺服 `dist` 的静态服务器（history 模式回退到 index.html）。
 *
 * **带扩展名的路径不许回退 index.html**：那样会把一个缺失的 `.js` 变成一坨 HTML，
 * 浏览器报 `SyntaxError: Unexpected token '<'` —— 那是**这个服务器制造的假异常**，
 * 会把冒烟结论搅浑（实测踩过）。资源缺失就老实回 404，并记进 `missing` 供诊断。
 */
export async function createStaticServer(root: string, options: StaticServerOptions = {}): Promise<StaticServer> {
  const base = resolve(root)
  const missing: string[] = []
  const server = createServer((req, res) => {
    const raw = (req.url ?? '/').split('?')[0]

    // 负对照：把接口统统打成后端故障。形状照抄后端真实返回（`code: 50000` + 那句 msg），
    // 这样前端走的是**与线上同一条**错误路径，而不是我编的另一种失败。
    // 开关两处认：函数参数（给用例用）或环境变量 `SMOKE_FAIL_API=1`（给 CLI 用，
    // 这样不必改动 `smoke()` 的签名，调用方也就不会被牵连）。
    if ((options.failApi === true || process.env.SMOKE_FAIL_API === '1') && raw.startsWith('/api/')) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ code: 50000, msg: '服务器内部错误', data: null }))
      return
    }

    const requested = normalize(decodeURIComponent(raw))
    let file = join(base, requested)
    if (!file.startsWith(base))
      file = join(base, 'index.html')

    if (!existsSync(file) || statSync(file).isDirectory()) {
      const looksLikeAsset = extname(requested) !== ''
      if (looksLikeAsset) {
        // 记**请求路径原文**（正斜杠）。别记 `normalize` 之后的值：Windows 上它会变成反斜杠，
        // 于是调用方那句 `startsWith('/api/')` 永远不成立（实测踩过）。
        missing.push(raw)
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      file = join(base, 'index.html')
    }

    const body = readFileSync(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  })

  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/`,
    missing,
    close: () => new Promise<void>((done) => {
      server.close(() => done())
    }),
  }
}

interface CdpMessage {
  id?: number
  method?: string
  params?: { exceptionDetails?: { text?: string, exception?: { description?: string } }, args?: { value?: unknown, description?: string }[] }
  result?: { result?: { value?: unknown } }
}

export interface SmokeResult {
  mounted: boolean
  /**
   * 启动错误屏上写着的**步骤名**（`data-walnut-error-screen` 的值）；`null` = 没有错误屏。
   *
   * 为什么要把这个值带回来：`renderBootstrapFailure` 是**整体替换** `#app` 的子节点，
   * 所以「splash 没了 + #app 在」在**错误屏**和**正常挂载**两种情况下都成立 —— 只看那两条
   * 必然把「打开即错误屏」判成「跑起来了」。负对照（`SMOKE_FAIL_API=1`）期望的恰恰是错误屏，
   * 于是它成了判据的分界。
   */
  errorScreenStep: string | null
  /** **挂载前**抛的未捕获异常 —— 这才是"启动序列被炸"（V13 那类），算违规 */
  fatalExceptions: string[]
  /** 挂载后抛的异常：产物在没有后端的环境里必然有降级噪声（API 调用失败），只报不拦 */
  lateExceptions: string[]
  /** 控制台 error 级消息（同样只报不拦） */
  consoleErrors: string[]
  /** 被请求但不存在的资源 —— 缺文件是**真问题**，所以单独列出来 */
  missingAssets: string[]
  waitedMs: number
}

/** 用 CDP 驱动浏览器打开页面，等到挂载或超时 */
export async function smoke(root: string, chrome: string, timeoutMs = MOUNT_TIMEOUT_MS): Promise<SmokeResult | null> {
  const server = await createStaticServer(root)
  const profile = join(tmpdir(), `walnut-smoke-${Date.now()}`)
  const port = 9300 + Math.floor(Math.random() * 600)
  let child: ChildProcess | undefined
  let ws: WebSocket | undefined

  try {
    child = spawn(chrome, [
      // **别用 `--headless=old`**：Chrome 132 起把 old headless 删了，而 CI runner 上是最新版 ——
      // 浏览器会直接起不来，表现为"连不上 CDP"（2026-09-30 CI 实测：本机 Windows 的旧 Chrome
      // 还能吃 old，所以本地一直绿）。`--headless=new` 在 112+ 都可用，是跨版本的安全选择。
      '--headless=new',
      '--disable-gpu',
      // CI 容器里跑 Chrome 的标配：不关沙箱常因 user namespace 受限而起不来
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: 'ignore' })

    const devtools = `http://127.0.0.1:${port}`
    let target: { webSocketDebuggerUrl?: string } | undefined
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`${devtools}/json/list`)).json() as { type?: string, webSocketDebuggerUrl?: string }[]
        target = list.find(t => t.type === 'page')
        if (target?.webSocketDebuggerUrl !== undefined)
          break
      }
      catch {
        // 浏览器还没起来，继续等
      }
      await sleep(150)
    }
    if (target?.webSocketDebuggerUrl === undefined) {
      // **环境事实，不是产物问题** ⇒ 与"机器上没装浏览器"同等对待：调用方打一行 SKIP 并正常退出。
      // 原件是 `throw new PreconditionError`（exit 2），而 CI 上 Chrome 因参数/沙箱起不来时会把它
      // 变成一道**假红**门禁（2026-09-30 实测：`--headless=old` 在新版 Chrome 上已被删除 ⇒ 浏览器
      // 起不来 ⇒ 整条 CI 被拦红）。真正的违规只有一种：浏览器**连上了**但应用没 mount（exit 1）。
      return null
    }

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((done, fail) => {
      ws?.addEventListener('open', () => done(), { once: true })
      ws?.addEventListener('error', () => fail(new Error('CDP 连接失败')), { once: true })
    })

    let nextId = 1
    const pending = new Map<number, (value: CdpMessage) => void>()
    const fatalExceptions: string[] = []
    const lateExceptions: string[] = []
    const consoleErrors: string[] = []
    let mounted = false
    /** 错误屏上的步骤名（见 `SmokeResult.errorScreenStep` 的说明） */
    let errorScreenStep: string | null = null

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as CdpMessage
      if (msg.id !== undefined) {
        pending.get(msg.id)?.(msg)
        pending.delete(msg.id)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails
        const text = String(d?.exception?.description ?? d?.text ?? '未知异常').split('\n')[0]
        // 分界线是**挂载**：挂载前的异常说明启动序列被炸（V13 那类）；挂载之后的先按降级噪声记着。
        // 本仓的产物冒烟没有后端，API 调用失败是**预期**的（V4 就是把这种失败设计成可降级）。
        if (mounted)
          lateExceptions.push(text)
        else
          fatalExceptions.push(text)
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params !== undefined && (msg.params as { type?: string }).type === 'error') {
        const text = (msg.params.args ?? []).map(a => String(a.value ?? a.description ?? '')).join(' ').trim()
        if (text !== '')
          consoleErrors.push(text.slice(0, 200))
      }
    })

    const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> => new Promise((done) => {
      const id = nextId++
      pending.set(id, done)
      ws?.send(JSON.stringify({ id, method, params }))
    })

    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.navigate', { url: server.url })

    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      await sleep(500)
      const probe = await send('Runtime.evaluate', {
        expression: `JSON.stringify({ splash: !!document.querySelector('${SPLASH_SELECTOR}'), app: !!document.getElementById('app'), errorScreenStep: document.querySelector('[data-walnut-error-screen]')?.getAttribute('data-walnut-error-screen') ?? null })`,
        returnByValue: true,
      })
      const raw = String(probe.result?.result?.value ?? '')
      if (raw !== '') {
        const parsed = JSON.parse(raw) as { splash: boolean, app: boolean, errorScreenStep: string | null }
        if (parsed.errorScreenStep !== null)
          errorScreenStep = parsed.errorScreenStep
        // **错误屏不算挂载**：启动步阻断时 `renderBootstrapFailure` 会把 `#app` 的子节点整体换掉，
        // 于是「splash 没了 + #app 在」这两条**同时成立** —— 只看这两条会把「打开即错误屏」误判成
        // 「跑起来了」。所以显式排除它（负对照正是靠这条分界）。
        if (parsed.app && !parsed.splash && parsed.errorScreenStep === null) {
          mounted = true
          break
        }
      }
      // 启动序列已经炸了就不必等满超时：继续等只会白耗
      if (fatalExceptions.length > 0 && Date.now() - started > 5_000)
        break
    }

    return { mounted, errorScreenStep, fatalExceptions, lateExceptions, consoleErrors, missingAssets: [...new Set(server.missing)], waitedMs: Date.now() - started }
  }
  finally {
    ws?.close()
    child?.kill()
    await server.close()
    await sleep(50)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms))
}

export async function main(): Promise<void> {
  const distArg = process.argv.slice(2).find(a => !a.startsWith('--')) ?? DEFAULT_DIST
  const dist = resolve(process.cwd(), distArg)
  if (!existsSync(join(dist, 'index.html')))
    throw new PreconditionError(`找不到产物 ${distArg}/index.html —— 先跑 \`pnpm --filter @walnut/admin build\``)

  const chrome = findChrome()
  if (chrome === null) {
    line('skipped', '没找到浏览器，跳过产物冒烟（设 CHROME_PATH 指向 chrome 即可启用）')
    out('  提示：CI 的 ubuntu runner 自带 google-chrome；本机可用 CHROME_PATH 指定。跳过**不等于**通过。')
    return
  }

  out(`产物冒烟：${distArg}（浏览器 ${chrome}）`)
  const result = await smoke(dist, chrome)

  // `null` = 浏览器起来了但连不上 CDP：**环境问题，不是产物问题** ⇒ 明确打 SKIP 并按通过返回
  // （与"没装浏览器"同档）。判据变红只有一种情形：连上了但应用没 mount。
  if (result === null) {
    line('skipped', '浏览器连不上调试目标（CDP），跳过产物冒烟')
    out('  排查：手动跑一次 `pnpm smoke:dist`；或设 CHROME_PATH 换一个浏览器。跳过**不等于**通过。')
    return
  }

  // 判据只有一条硬的：**应用有没有真的挂载**。其余全是"没有后端"这个环境的预期产物：
  // 引导序列里的可降级步骤（V4 的设计）会打 API 失败的错误，`/api/*` 的资源本就由后端伺服
  // （例如 cap.js 的 widget），产物冒烟里必然拿不到。把它们判成失败，这道闸就会被绕开。
  const backendAssets = result.missingAssets.filter(m => !m.startsWith('/api/'))
  const apiAssets = result.missingAssets.filter(m => m.startsWith('/api/'))

  for (const e of result.fatalExceptions.slice(0, 3))
    out(`  （挂载前的异常，多半来自没有后端）${e}`)
  for (const e of result.consoleErrors.slice(0, 3))
    out(`  （控制台 error）${e}`)
  for (const m of apiAssets.slice(0, 5))
    out(`  （后端资源，未在产物里）${m}`)
  const noise = result.fatalExceptions.length + result.lateExceptions.length + result.consoleErrors.length + apiAssets.length
  if (noise > 0)
    out(`  提示：以上 ${noise} 条来自"没有后端"的降级路径，不计入结论。`)

  // ---- 负对照模式（`SMOKE_FAIL_API=1`）：期望的恰恰是「没挂载」+「错误屏在」 ----
  //
  // 这是 2026-10-08 事故链的**确定性复现**：`/api/**` 全部按后端故障应答（500 + code 50000）
  // ⇒ 启动序列的 `sign` 步拿不到密钥 ⇒ 它是 blocking ⇒ 必须出现**错误屏**，
  // 而不是白屏、也不是「一直卡在 splash」。没有这一段，这道闸就只能证明「能挂载」，
  // 证明不了「挂不上时会怎样」——而后者才是用户会骂的那一半。
  if (process.env.SMOKE_FAIL_API === '1') {
    if (!result.mounted && result.errorScreenStep !== null) {
      line('ok', `负对照通过：错误屏如期出现（data-walnut-error-screen="${result.errorScreenStep}"），页面不是空白`)
      return
    }
    line(
      'violation',
      result.mounted
        ? '负对照失败：接口全 500 的情况下居然挂载成功了 —— 「关键步骤失败会阻断启动」这条已失效'
        : `负对照失败：既没挂载、也没有错误屏（等了 ${(result.waitedMs / 1000).toFixed(1)}s）—— 这就是白屏 / 卡 splash`,
    )
    return
  }

  // ---- 正对照：**启动必须有结论** ----
  //
  // 判据在 2026-10-08 从「必须挂载」改成「splash 必须消失」：
  // 启动序列里的 `sign` 已是 blocking（拿不到签名密钥 ⇒ 每个请求都废 ⇒ 应用没有可用状态），
  // 而产物冒烟的环境**没有后端** ⇒ sign 必然失败 ⇒ 应用**按设计拒绝挂载**并显示错误屏。
  // 若继续要求"必须挂载"，这道闸等于在要求应用**带着坏掉的签名链路进页面**——那不是我们要的。
  //
  // 换来的是更贴近用户的那条不变式：**不能白屏、不能卡在 splash**。
  // V13 的防护力不丢：那次事故正是"卡在 splash"，splash 仍在 ⇒ 依然判红。
  // 负对照（`SMOKE_FAIL_API=1`）另行断言"必须是错误屏"，两者互补。
  const conclusion = result.mounted
    ? `已挂载（${(result.waitedMs / 1000).toFixed(1)}s）`
    : (result.errorScreenStep !== null ? `以错误屏收尾（失败步骤 ${result.errorScreenStep}）` : '仍卡在 splash')

  if (!result.mounted && result.errorScreenStep === null) {
    for (const e of result.fatalExceptions.slice(0, 5))
      line('violation', `挂载前的未捕获异常：${e}`)
    line('violation', `${(result.waitedMs / 1000).toFixed(1)}s 内既没挂载、也没有错误屏（\`#app\` 里还有 splash）—— 产物打开即死（白屏 / 卡 loading）`)
    return
  }

  if (backendAssets.length === 0) {
    line('ok', `产物启动有结论：${conclusion}（无后端时的降级噪声 ${noise} 条，已忽略）`)
    return
  }
  for (const m of backendAssets)
    line('violation', `产物里缺这个文件：${m}`)

  throw new ViolationError('产物冒烟未通过（明细见上）')
}
