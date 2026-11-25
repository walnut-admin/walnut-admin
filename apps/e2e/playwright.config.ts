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
 */
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { SIGN_USER_AGENT } from './lib/protocol/sign.ts'
import {
  BACKEND_ORIGIN,
  backendEnvOverrides,
  E2E_ROOT,
  SERVER_ROOT,
  WEB_ORIGIN,
} from './scripts/env.ts'

/**
 * webServer 是否复用已在监听的进程。**默认关**：
 * - 后端把 `app_setting` 读进进程内 memo（apps/server/libs/cache/src/service/appSettings.cache.ts），
 *   而 prepare-db 每轮都重建库（含放宽后的 CAP 节流设置）—— 复用旧进程就会读到旧库的读数；
 * - 前端静态代理伺服的目录也因此可能不是本轮产物（README「排障」最后一条就是这种现场）。
 * `E2E_REUSE_SERVER=1` 只给「明确知道 3001/4173 上跑的就是本轮产物」的本地调试用。
 */
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1'

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
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
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
      command: 'pnpm run start:stage',
      cwd: SERVER_ROOT,
      url: `${BACKEND_ORIGIN}/health/ready`,
      timeout: 180_000,
      reuseExistingServer,
      env: serverEnv(),
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // 前端：dist-staging + /api、/socket 反代（保留 XFF 等头）
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
      // smoke 与 system（用户 CRUD）都算冒烟面：前者是 UI，后者走真实协议
      testMatch: [/smoke\/.*\.spec\.ts/, /system\/.*\.spec\.ts/],
      dependencies: ['auth-setup'],
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
      // 依赖真实外网的用例用 @network 标记，由独立的 network project 跑（离线环境里 risk 应为绿）
      grepInvert: /@network/,
      // 设备用例全部自建 context（每台设备一个），不继承 storageState
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
    {
      name: 'network',
      // 只跑带 @network 标记的用例（当前是设备用例里的 U1b：非 local IP 走 api.ip.sb 的真实定位）。
      // 依赖链与 risk 相同：只需要 stack-setup（它负责 MFA 绑定与凭据文件）。
      testMatch: /risk\/.*\.spec\.ts/,
      grep: /@network/,
      dependencies: ['stack-setup'],
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
  ],
})
