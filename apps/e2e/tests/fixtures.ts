/**
 * Playwright 的 test 扩展：**设备自动清理**（P1-2）、**worker 级共享只读登录 context**（P0-3）
 * 与**失败现场取证**（P1-3）。
 *
 * 为什么清理必须是 fixture：断言失败会跳过用例末尾的手写 `cleanupDevices(...)` —— 失败越多，
 * 留下的设备行与 Redis 键越多，下一轮的读数就被上一轮的残渣污染（而这一层要看真话）。
 * fixture 的 teardown 在用例失败后照样执行。
 *
 * 失败现场同理：`testInfo.status` 不是 passed/skipped 时 attach 三份**纯元数据**——
 * `stack.json`（本轮 commit / 端口 / 产物 mtime / 产物落后源码多少分钟）、
 * `baseline-manifest.json`（sha / 迁移头 / 菜单行数）与最近 20 条业务响应（只取
 * url/status/code/msg，无响应体）。全部经 `lib/redact.ts` 脱敏后才落盘 —— attach 与 junit
 * 一样是「可能被带走」的产物，不变量 8 的严格口径按「宁可多杀」执行。
 *
 * 收集方式：设备由 `lib/device-fixtures.ts` 的 `trackDevice` 登记（工厂函数自动登记；手写签发的
 * 设备由用例自己登记）。作用域分三层：
 *
 * - **test 作用域（auto）**：每条用例结束 attach（失败时）+ 清一次 —— 失败的那条也不留残渣，
 *   清理失败的 id 留给下面那层再试；
 * - **worker 作用域（auto）**：本 project 的 worker 退出时再清一次兜底。
 *   Playwright 每个 project 一个 worker 进程，所以实际粒度是「每个 project 一次」；
 * - **worker 作用域共享设备**（`trackWorkerDevice`）：只给 `authedContext` 用，它在多条用例间
 *   存活，不能在某条用例结束时被上面那层顺手删掉。
 *
 * 两层清理都**不抛错**：失败只 `console.warn`（test 作用域还会 attach 到 testInfo），
 * 绝不让收尾动作掩盖真正的断言失败。
 */
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test as base } from '@playwright/test'
import {
  flushTrackedDevices,
  flushWorkerTrackedDevices,
  newBrowserContext,
  resolveDeviceId,
  trackWorkerDevice,
} from '../lib/device-fixtures.ts'
import { redactDeep } from '../lib/redact.ts'
import { loginViaUI, snapshotRecentEnvelopes } from '../lib/ui.ts'
import { BASELINE_MANIFEST_FILE, STACK_INFO_FILE } from '../scripts/env.ts'

export { expect } from '@playwright/test'

/** stack.json 里允许进附件的字段（白名单：将来加字段要显式放行，凭据类字段永远不在清单里） */
const STACK_ATTACH_FIELDS = [
  'runId',
  'startedAt',
  'commit',
  'urls',
  'pg',
  'redis',
  'cookies',
  'artifacts',
  'freshness',
  'credentialsFile',
] as const

/** 封板清单的字段（全是元数据：dataKey / sha / 迁移头 / 菜单行数 / HEAD，没有口令） */
const MANIFEST_ATTACH_FIELDS = [
  'manifestVersion',
  'sealedAt',
  'gitCommit',
  'dataKey',
  'dataDirty',
  'migrationsHead',
  'dumpSha256',
  'dumpBytes',
  'credentialsSha256',
  'credentialsBytes',
  'menuRows',
] as const

/** attach 的 envelope 条数（错误消息里是 12 条；附件留多一点，便于串起失败前的请求序列） */
const ATTACH_ENVELOPE_LIMIT = 20

function readJsonFile(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

/** 只保留白名单字段（不改入参） */
function pickFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in source) {
      out[field] = source[field]
    }
  }
  return out
}

/**
 * `credentialsFile` **只留路径**：即使将来有人把凭据内容塞进 stack.json，附件里也不会带出去。
 */
function stackProjection(stack: Record<string, unknown>): Record<string, unknown> {
  const out = pickFields(stack, STACK_ATTACH_FIELDS)
  if (typeof out.credentialsFile !== 'string') {
    delete out.credentialsFile
  }
  return out
}

/**
 * 把一份 JSON 附件写到**本用例的 output 目录**再按 `path` attach。
 *
 * 为什么不用 `body`（内存附件）：body 只活在 reporter 里 —— junit 不列它、`test-results/`
 * 下没有文件，负对照与「不登录 runner 也能取证」都无从谈起。按 path attach 会同时留下
 * 原文件与 `attachments/` 下的副本，junit 的 `[[ATTACHMENT|…]]` 也能指过去。
 */
async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  try {
    const file = testInfo.outputPath(name)
    // outputPath() 只算路径不建目录；用例在 before-hooks 阶段就失败时目录可能还没建
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(redactDeep(value), null, 2)}\n`, 'utf8')
    await testInfo.attach(name, { path: file, contentType: 'application/json' })
  }
  catch (error) {
    // attach 失败绝不掩盖真正的断言失败（它是收尾动作，不是判据）
    console.warn(`[e2e/fixtures] attach ${name} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 失败现场的三份附件（stack / 基线清单 / 最近业务响应）；文件名固定，便于 CI 侧说明引用 */
async function attachFailureEvidence(testInfo: TestInfo): Promise<void> {
  if (testInfo.status === 'passed' || testInfo.status === 'skipped') {
    return
  }

  const stack = readJsonFile(STACK_INFO_FILE)
  await attachJson(
    testInfo,
    'stack.json',
    stack === null ? { missing: true, path: STACK_INFO_FILE } : stackProjection(stack),
  )

  const manifest = readJsonFile(BASELINE_MANIFEST_FILE)
  await attachJson(
    testInfo,
    'baseline-manifest.json',
    manifest === null
      ? { missing: true, path: BASELINE_MANIFEST_FILE }
      : pickFields(manifest, MANIFEST_ATTACH_FIELDS),
  )

  await attachJson(testInfo, 'recent-envelopes.json', {
    capturedAt: new Date().toISOString(),
    note: '只含 url/status/code/msg（无响应体）；已脱敏',
    entries: snapshotRecentEnvelopes(ATTACH_ENVELOPE_LIMIT).map(entry => ({
      url: entry.url,
      status: entry.status,
      code: entry.code,
      msg: entry.msg,
    })),
  })
}

export const test = base.extend<
  { deviceCleanup: void, authedPage: Page },
  { deviceCleanupRun: void, authedContext: BrowserContext }
>({
  // Playwright 的 fixture 回调首参是「本 fixture 依赖的其它 fixture」映射；这两条不依赖任何
  // fixture（也不该依赖：test 作用域要是写上 `page`，每条用例都会被强制开一个页面）。
  // eslint-disable-next-line no-empty-pattern -- 空映射是 Playwright 的签名，不是笔误
  deviceCleanupRun: [async ({}, use) => {
    await use()
    await flushTrackedDevices()
    await flushWorkerTrackedDevices()
  }, { scope: 'worker', auto: true }],

  // eslint-disable-next-line no-empty-pattern -- 同上
  deviceCleanup: [async ({}, use, testInfo: TestInfo) => {
    await use()
    // 取证在清理之前：设备行 / Redis 键还在时，附件里的 device id 与 PG 现场对得上
    await attachFailureEvidence(testInfo)
    await flushTrackedDevices({ testInfo })
  }, { auto: true }],

  /**
   * worker 级共享的**只读**已登录 context：worker 启动时走一次完整 UI 登录，之后同一 worker
   * 的只读用例直接复用它（`authedPage` 每次从它开一个新页面）。
   *
   * 为什么这不是 storageState 复用（不变量 7 仍然成立）：
   * - **不落盘、不跨进程**：登录态只活在这个 worker 的浏览器 context 内存里（IndexedDB 的
   *   AES `CryptoKey` 也在），进程退出即消失；没有写任何 storageState 文件，也没有在
   *   project 上挂 `storageState`。
   * - 它只服务于**只读**用例（无写操作、无「全新设备」语义）；有写操作或需要新设备身份的
   *   用例必须自己开 context（`lib/device-fixtures.ts` 的 `openDevice` / `loginDevice`）。
   * - 这台设备登记为 **worker 作用域**（`trackWorkerDevice`），由 worker 级 auto fixture
   *   在进程退出时清理 —— 不会被某条用例的 test 作用域清理提前删掉。
   */
  authedContext: [async ({ browser }, use) => {
    const context = await newBrowserContext(browser)
    const page = await context.newPage()
    await loginViaUI(page)
    trackWorkerDevice(await resolveDeviceId(page))
    // 登录页关闭后登录态仍留在 context（cookies + localStorage + IndexedDB）里
    await page.close()
    await use(context)
    await context.close()
  }, { scope: 'worker' }],

  /** 共享已登录 context 里的新页面（每个只读用例一份，避免上一用例的页面状态串过来） */
  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
    await page.close()
  },
})
