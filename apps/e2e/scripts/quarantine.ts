/**
 * Flaky 隔离名单（P2-1）：`quarantine.json` 的读取、校验与「从默认执行中排除」的 grep 构造。
 *
 * 机制分成两层，缺一不可：
 * 1. **用例侧标签**：要隔离的用例挂 `{ tag: '@quarantine' }`（P1-5 已建的原生 tag），
 *    这样人工复查可以 `--grep @quarantine` 只跑它们；
 * 2. **名单侧排除**：本文件的条目按 `testName`（用例标题，**不含** project 名）生成正则，
 *    由 `playwright.config.ts` 挂到各 project 的 `grepInvert` —— 默认全量不会执行它们。
 *
 * 为什么用配置级 `grepInvert` 而不是用例级 `test.skip()`：
 * - 名单是**运行前**的决策，`test.skip()` 要写进 spec、把「为什么跳过」的事实藏进代码；
 * - `run.ts` 追加 CLI `--grep-invert` 会**覆盖** config 里 risk project 的 `/@network/` 排除
 *   （CLI 优先于 config），等于把 @network 用例带进离线 run —— 这是不变量级的事故；
 *   配置级 `grepInvert` 可以和 `/@network/` 并存（数组形式），两条排除同时生效。
 *
 * `E2E_INCLUDE_QUARANTINE=1`（nightly 复核 / 人工排查）时本模块返回空名单，等于不排除。
 *
 * **本仓口径的取舍**：仓库当前只有 nightly、没有 PR 门禁，所以「nightly 跑但不作为门禁」
 * 没有第二道可挂。默认把名单条目从 nightly 全量里排除，等于「隔离 = 不跑」；entry 的
 * `owner` + `reviewAt` 是防止它被遗忘的唯一机制（到期会在 config 加载时告警）。要让 nightly
 * 真正跑到它们又不当门禁，需要独立的 continue-on-error job（另起一套库 / 产物），成本与
 * 误报噪音都不划算 —— 需要时用 `E2E_INCLUDE_QUARANTINE=1 pnpm walnut e2e -- --grep @quarantine`
 * 人工跑一遍并在名单里更新结论。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { E2E_ROOT } from './env.ts'

/** 名单文件（仓库根内的 apps/e2e/quarantine.json；随源码提交，不是 gitignored 的 .e2e/） */
export const QUARANTINE_FILE = path.join(E2E_ROOT, 'quarantine.json')

export interface QuarantineEntry {
  /** 用例标题（Playwright 的 `test(...)` 第一个参数，**不含** describe / project 前缀） */
  testName: string
  /** 追踪 issue / PR / 讨论链接（没有就写清楚「谁在什么上下文里看到的」） */
  issue: string
  /** 负责人（GitHub handle 或本仓约定的人名） */
  owner: string
  /** 加入日期（YYYY-MM-DD） */
  addedAt: string
  /** 复查日期（YYYY-MM-DD）；到期未复查会在 config 加载时告警 */
  reviewAt: string
}

const REQUIRED_FIELDS = ['testName', 'issue', 'owner', 'addedAt', 'reviewAt'] as const
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验名单（纯函数）。**宁可比对失败也不要静默忽略**：一个拼错的字段会让「已隔离」
 * 变成「没隔离」，而现象是 nightly 忽然红 —— 比配置期报错难查得多。
 */
export function parseQuarantine(raw: unknown): QuarantineEntry[] {
  if (!Array.isArray(raw)) {
    throw new TypeError('[e2e/quarantine] quarantine.json 顶层必须是数组（空列表写 []）')
  }

  const seen = new Set<string>()
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`[e2e/quarantine] 第 ${index + 1} 条不是对象`)
    }
    for (const field of REQUIRED_FIELDS) {
      const value = item[field]
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`[e2e/quarantine] 第 ${index + 1} 条缺字段 ${field}（必须是非空字符串）`)
      }
    }
    const entry = item as unknown as QuarantineEntry
    for (const field of ['addedAt', 'reviewAt'] as const) {
      if (!DATE_PATTERN.test(entry[field])) {
        throw new Error(`[e2e/quarantine] 第 ${index + 1} 条的 ${field} 必须是 YYYY-MM-DD：${entry[field]}`)
      }
    }
    if (seen.has(entry.testName)) {
      throw new Error(`[e2e/quarantine] 用例重复登记：${entry.testName}`)
    }
    seen.add(entry.testName)
    return entry
  })
}

/** 读并校验名单（文件缺失 / 非法 JSON / 字段不对都抛错，由 config 加载期暴露） */
export function loadQuarantine(file = QUARANTINE_FILE): QuarantineEntry[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  }
  catch (error) {
    throw new Error(`[e2e/quarantine] 读不到隔离名单 ${file}：${error instanceof Error ? error.message : String(error)}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  }
  catch (error) {
    throw new Error(`[e2e/quarantine] ${file} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }

  return parseQuarantine(raw)
}

/** 把标题按字面转正则（标题里的 `(` `[` `?` 等不能被当成语法；本仓标题有全角括号，也别赌） */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 名单 → `grepInvert` 正则。空名单返回 `undefined`（**零影响**：不挂任何排除）。
 *
 * 用 `|` 连接各标题的**字面**转义：Playwright 的 grep 是子串匹配，不需要锚点；
 * 锚定反而会因「标题路径包含 project / 文件名」而漏掉。
 */
export function buildQuarantineGrepInvert(entries: readonly QuarantineEntry[]): RegExp | undefined {
  if (entries.length === 0) {
    return undefined
  }
  return new RegExp(entries.map(entry => escapeRegExp(entry.testName)).join('|'))
}

/** 已过复查日期的条目（`today` 用 YYYY-MM-DD 或 Date；纯字符串比较，ISO 日期可比） */
export function overdueEntries(entries: readonly QuarantineEntry[], today: string = new Date().toISOString().slice(0, 10)): QuarantineEntry[] {
  return entries.filter(entry => entry.reviewAt < today)
}
