/**
 * Playwright 配置 —— 全链路 E2E（真实浏览器 × 真实后端进程 × 独立 PG/Redis 栈）。
 *
 * 三个刻意的决定：
 * 1. **workers=1 / fullyParallel=false / retries=0**：用例共享同一个后端与库，设备身份、Redis
 *    风险缓存、`sys_device` 行都按 deviceId 互相影响。并发会让「新设备」「续期」这类断言随机红；
 *    retries 会把「确实坏了」洗成「第二次过了」——这一批要看真话。
 * 2. **DB 的 drop/迁移/seed 不在 globalSetup**：Playwright 先起 webServer 再跑 globalSetup
 *    （官方已知顺序），而 webServer 的后端一连库就要有库。所以建库在包脚本里
 *    （`node scripts/prepare-db.ts && playwright test`）。
 * 3. **userAgent 用真实 Chrome 串**（与协议客户端同一常量）：签名原文取 navigator.userAgent，
 *    与请求头必须逐字一致；默认 headless UA 还会被 security.guard 判 bot（40608）。
 *    别改成 extraHTTPHeaders（那只改请求头，不改 navigator）。
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
      reuseExistingServer: !process.env.CI,
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
      reuseExistingServer: !process.env.CI,
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
      // 刻意**不挂** storageState：实测 `storageState({indexedDB:true})` 恢复不了 IndexedDB 里的
      // AES CryptoKey（Phase 0 gate 2 = failed，见 .auth/gate-report.json）——把坏状态灌进
      // context 会让应用卡在 splash（模块顶层 await 解密抛错、永不 mount）。
      // 结论：每条冒烟用例自己走 UI 登录（ensureLoggedIn），慢但确定。
    },
    {
      name: 'risk',
      testMatch: /risk\/.*\.spec\.ts/,
      dependencies: ['auth-setup'],
      // 设备用例全部自建 context（每台设备一个），不继承 storageState
      use: { ...devices['Desktop Chrome'], userAgent: SIGN_USER_AGENT },
    },
  ],
})
