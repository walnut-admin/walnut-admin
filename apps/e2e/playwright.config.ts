/**
 * Playwright 配置 —— 全链路 E2E（真实浏览器 × 真实后端进程 × 独立 PG/Redis 栈）。
 *
 * 四个刻意的决定：
 * 1. **workers=1 / fullyParallel=false / retries=0**：用例共享同一个后端与库，设备身份、Redis
 *    风险缓存、`sys_device` 行都按 deviceId 互相影响。并发会让「新设备」「续期」这类断言随机红；
 *    retries 会把「确实坏了」洗成「第二次过了」——这一批要看真话。
 * 2. **DB 的 drop/迁移/seed 不在 globalSetup**：Playwright 先起 webServer 再跑 globalSetup
 *    （官方已知顺序），而 webServer 的后端一连库就要有库。所以建库在编排脚本里
 *    （`node scripts/run.ts`：preflight → prepare-db → stack-info → playwright test）。
 * 3. **userAgent 用真实 Chrome 串**（与协议客户端同一常量）：签名原文取 navigator.userAgent，
 *    与请求头必须逐字一致；默认 headless UA 还会被 security.guard 判 bot（40608）。
 *    别改成 extraHTTPHeaders（那只改请求头，不改 navigator）。
 * 4. **webServer 不复用已有进程**（`E2E_REUSE_SERVER=1` 才显式打开）：后端在进程里缓存了一份
 *    应用设置 memo，而 prepare-db 每次都 DROP DATABASE 重建 —— 复用一个「上一个库」启动的进程
 *    会读到错状态。3001 上有没有残留进程不该由测试去猜。
 *
 * 5. **profile（P1-6 Phase A）**：baseURL / 两个 webServer 的端口都来自 `scripts/env.ts`，
 *    后者从 `scripts/stack-profiles.ts` 派生（`E2E_STACK_PROFILE` 选择）。这层不自己拼端口；
 *    profile 与 project 的 1:1 约束由 `scripts/run.ts` 的 `resolveProfileTestArgs` 机械保证。
 */
import path from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { SIGN_USER_AGENT } from './lib/protocol/sign.ts'
import { BACKEND_ORIGIN, backendEnvOverrides, E2E_ROOT, TEST_RESULTS_DIR, WEB_ORIGIN } from './scripts/env.ts'
import { buildQuarantineGrepInvert, loadQuarantine, overdueEntries } from './scripts/quarantine.ts'

/**
 * webServer 是否复用已在监听的进程。**默认关**：
 * - 后端把 `app_setting` 读进进程内 memo（apps/server/libs/cache/src/service/appSettings.cache.ts），
 *   而 prepare-db 每轮都重建库（含放宽后的 CAP 节流设置）—— 复用旧进程就会读到旧库的读数；
 * - 前端静态代理伺服的目录也因此可能不是本轮产物（README「排障」最后一条就是这种现场）。
 * `E2E_REUSE_SERVER=1` 只给「明确知道 3001/4173 上跑的就是本轮产物」的本地调试用。
 */
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1'

/**
 * Flaky 隔离名单（P2-1）：`quarantine.json` 的条目按用例标题生成 `grepInvert`，默认从
 * **所有业务 project** 中排除；`E2E_INCLUDE_QUARANTINE=1` 时整份忽略（人工复查 / nightly
 * 之外的单跑）。空名单 ⇒ `undefined`，不挂任何排除（零影响）。
 *
 * 为什么挂在 config 而不是 run.ts 的 CLI 参数：CLI 的 `--grep-invert` 会覆盖 risk project
 * 的 `/@network/`（CLI 优先），等于把外网用例带进离线 run；config 里用数组可以和它并存。
 * 机制与取舍的完整说明见 `scripts/quarantine.ts` 头注释。
 */
const quarantineEntries = process.env.E2E_INCLUDE_QUARANTINE === '1' ? [] : loadQuarantine()
const quarantineGrepInvert = buildQuarantineGrepInvert(quarantineEntries)
if (quarantineGrepInvert !== undefined) {
  console.log(`[e2e/quarantine] 默认排除 ${quarantineEntries.length} 条隔离用例（E2E_INCLUDE_QUARANTINE=1 显式包含）`)
  for (const overdue of overdueEntries(quarantineEntries)) {
    console.warn(`[e2e/quarantine] 已过复查日期 ${overdue.reviewAt}：${overdue.testName}（owner=${overdue.owner}，issue=${overdue.issue}）`)
  }
}

/** webServer 的 env 必须是纯 string 映射（process.env 里有 undefined，不能直接展开） */
function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return { ...env, ...backendEnvOverrides() }
}

export default defineConfig({
  testDir: './tests',
  outputDir: TEST_RESULTS_DIR,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  /**
   * 四个 reporter 的分工（新增 junit / json 的判据见优化文档 P1-3）：
   * - `list`：本机人读；
   * - `html`：本机看失败现场（含请求头与响应体 ⇒ **只留本机，不上传**，见 AGENTS.md 不变量 8）；
   * - `junit` / `json`：机器可读（CI 的测试结果面板 / 统计）。**不含**请求头与响应体，
   *   是严格 artifact 口径里允许上传的两份（另一份是脱敏后的 backend.log）。
   */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: path.join(TEST_RESULTS_DIR, 'junit.xml') }],
    ['json', { outputFile: path.join(TEST_RESULTS_DIR, 'results.json') }],
  ],

  use: {
    baseURL: WEB_ORIGIN,
    userAgent: SIGN_USER_AGENT,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // `127.0.0.1` 是本栈唯一入口（webServer + 静态代理都在这个地址上监听）
    ignoreHTTPSErrors: false,
  },

  webServer: [
    {
      // 后端：dist-stage 产物 + NODE_ENV=stage（cookie 无前缀形态）；连接目标由 env 覆盖，
      // OPAQUE/cookie/JWT 等根密钥仍取 .env.stage（与前端构建内嵌的公钥同源）。
      //
      // command 指向**包装脚本**而不是 `pnpm run start:stage`：脚本负责 spawn 后端、把
      // stdout/stderr tee 到 `test-results/backend.log` 并在写入前脱敏（scripts/start-backend.ts）。
      // 后端进程的 cwd 由脚本自己设为 apps/server（ConfigModule 用 process.cwd() 定位 env），
      // 所以这里 cwd 用 E2E_ROOT（与静态代理同口径，便于 `node scripts/…` 的相对路径）。
      // stdout 从 'ignore' 改成 'pipe'：包装脚本的输出（已脱敏）要进控制台 / CI job 日志。
      command: 'node scripts/start-backend.ts',
      cwd: E2E_ROOT,
      url: `${BACKEND_ORIGIN}/health/ready`,
      timeout: 180_000,
      reuseExistingServer,
      env: serverEnv(),
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // 前端：dist-staging + /api、/socket 反代（保留 XFF 等头）。
      //
      // **不套包装脚本**（与后端不同）：它的输出只有一行启动日志（伺服目录 / 端口 / 反代目标），
      // 不含请求头与响应体，没有可脱敏的内容；失败时（端口占用 / 缺产物）走 stderr，本来就被
      // Playwright 转给 reporter（下面的 stderr: 'pipe'），CI 的 job 日志里能直接看到。
      // 给它单独落一份日志只会多一个「要不要上传」的口子 —— 严格 artifact 口径只允许五样文件。
      command: 'node scripts/static-server.ts',
      cwd: E2E_ROOT,
      url: WEB_ORIGIN,
      timeout: 60_000,
      reuseExistingServer,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],

  projects: [
    {
      name: 'stack-setup',
      testMatch: /setup\/stack\.setup\.ts/,
    },
    {
      name: 'auth-setup',
      testMatch: /setup\/auth\.setup\.ts/,
      dependencies: ['stack-setup'],
    },
    {
      name: 'smoke',
      // smoke 与 system（用户 CRUD）都算冒烟面：前者是 UI，后者走真实协议。
      // 两条用例都带 `@smoke`（Playwright 原生 tag，不是标题文字）—— `--grep @smoke` 能选它们。
      testMatch: [/smoke\/.*\.spec\.ts/, /system\/.*\.spec\.ts/],
      dependencies: ['auth-setup'],
      // P2-1：名单里的用例默认不跑（见上方 quarantineGrepInvert；空名单是 undefined）
      grepInvert: quarantineGrepInvert,
      use: {
        ...devices['Desktop Chrome'],
        // `devices['Desktop Chrome']` 会写自己的 userAgent —— 必须盖回真实 Chrome 串
        userAgent: SIGN_USER_AGENT,
      },
      // 刻意**不挂** storageState：`storageState({indexedDB:true})` 恢复不了 IndexedDB 里的
      // AES CryptoKey（Phase 0 gate 已判死：把坏状态灌进 context 会让应用卡在 splash ——
      // 模块顶层 await 解密抛错、永不 mount）。所以每条冒烟用例自己走 UI 登录（ensureLoggedIn），
      // 慢但确定；auth.setup 只做「全新设备登录」这条链路的门禁断言，不产出可复用的登录态。
    },
    {
      name: 'risk',
      testMatch: /risk\/.*\.spec\.ts/,
      // risk 不消费 storageState（每条用例自建 context），只需要 stack-setup 写好的 TOTP secret ——
      // 刻意不挂 auth-setup：那 41s 的 UI 登录对设备用例没有铺垫作用。
      dependencies: ['stack-setup'],
      // 整组挂 `@risk`；依赖真实外网的用例带 `@network` tag，由独立的 network project 跑
      // （离线环境里 risk 应为绿）。tag 与标题文字都能被 `--grep` 匹配，但本仓统一只用 tag。
      // P2-1 的隔离名单与 @network 排除**并存**：两条 grepInvert 都要生效。
      grepInvert: quarantineGrepInvert === undefined
        ? /@network/
        : [/@network/, quarantineGrepInvert],
      // 设备用例全部自建 context（每台设备一个），不继承 storageState
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
    {
      /**
       * 设备 profile 矩阵的起步规模（计划页 Phase 3 第 3 项）：**一个 mobile（Pixel 7）布局用例**。
       *
       * 这里用的是 **Playwright device profile**，不是 stack profile（R3 的「库 / 端口 / 基线」
       * 维度）：它共用 default 栈，只换浏览器描述符。理由：唯一需要 mobile 的断言是响应式几何量，
       * 不是业务链路 —— 为一条秒级布局用例复制一整套库 / 端口 / 基线不划算；设备身份是服务端
       * cookie，business spec 在 mobile 上重跑只会多跑几遍同一条逻辑（见 `tests/mobile/layout.spec.ts`）。
       *
       * `devices['Pixel 7']` 自带移动 UA —— 必须放在 SIGN_USER_AGENT 之后（project use 覆盖
       * 顶层 use）：签名原文取 `navigator.userAgent`，Playwright 会把该 UA 同时写进 navigator
       * 与请求头；security.guard 的白名单含 Mobile Chrome / Android。
       */
      name: 'mobile',
      testMatch: /mobile\/.*\.spec\.ts/,
      // 只依赖 stack-setup（后端就绪 + TOTP 绑定）；用例不登录，auth-setup 用不上
      dependencies: ['stack-setup'],
      grepInvert: quarantineGrepInvert,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'network',
      // 只跑带 `@network` tag 的用例（当前是设备用例里的 U1b：非 local IP 走 api.ip.sb 的真实定位）。
      // 依赖链与 risk 相同：只需要 stack-setup（它负责 MFA 绑定与凭据文件）。
      testMatch: /risk\/.*\.spec\.ts/,
      grep: /@network/,
      // P2-1：隔离名单同样作用于 network project（@network 用例也可能被隔离）
      grepInvert: quarantineGrepInvert,
      dependencies: ['stack-setup'],
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
    {
      /**
       * 扩面批次（E4）：admin 页面渲染 / 导航。**这不是新栈** —— 它和其它命名 profile 一样
       * （库 `walnut_e2e_pages`、端口 3104 / 3014 / 4184、基线 `.e2e/pages/`），
       * 由 `E2E_STACK_PROFILE=pages` 选中；profile 与 project 同名 1:1，跑别的 project 会被
       * `scripts/run.ts` 的 `resolveProfileTestArgs` 在动锁 / 动库之前拒绝。
       *
       * `tests/pages/` 本批只落 README：spec 由 E4 补齐。空目录下 `--project=pages` 会以
       * 「No tests found」退出非零 —— 这是本阶段的**诚实状态**（CI 的 pages job 在 E4 落地前
       * 预期红），别用 skip 占位把它洗成绿。
       */
      name: 'pages',
      testMatch: /pages\/.*\.spec\.ts/,
      // **刻意先不挂 `auth-setup`**：只在 `--project=pages` 下、依赖 project 有用例时，Playwright
      // 会「跑完依赖并返回 0」—— 空 project 因此假绿。E4 落地 spec 时再按需补
      // `dependencies: ['auth-setup']`（页面渲染断言需要已登录会话）。
      grepInvert: quarantineGrepInvert,
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
    {
      /**
       * 扩面批次（E5）：socket / auth / 锁屏的跨端旅程。profile 名 = project 名 = `journey`
       * （库 `walnut_e2e_journey`、端口 3105 / 3015 / 4185、基线 `.e2e/journey/`）。
       *
       * `tests/journey/` 本批只落 README：spec 由 E5 补齐；空目录下 `--project=journey` 同样
       * 「No tests found」退出非零（CI 的 journey job 在 E5 落地前预期红）。
       */
      name: 'journey',
      testMatch: /journey\/.*\.spec\.ts/,
      // 同 pages：先不挂 auth-setup，否则空 project 会因依赖用例假绿；E5 落地时再加。
      grepInvert: quarantineGrepInvert,
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
  ],
})
