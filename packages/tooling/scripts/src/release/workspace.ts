/**
 * 发版专属的**只读**工作区视图 + 意图收尾。
 *
 * 本模块回答三类问题：
 *   ① 版本：当前版本、某个 ref 上的版本、fixed 组里谁没对齐；
 *   ② 意图：盘上有哪些、哪些**未被 ledger 记账**（= 真的还没消费）、本次版本消费了哪些；
 *   ③ 「发版自己会改的文件」判据（用于把无关改动与发版改动分开）。
 *
 * `deleteConsumedIntents()` 是本模块唯一的写操作，理由见它的注释。
 */

import type { Intent } from './intents.ts'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PreconditionError } from '../lib/errors.ts'
import { fileAtRef, lsFilesStrict } from '../lib/git.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { versionedPackages } from './attribution.ts'
import { parseIntent } from './intents.ts'

/** 版本来源：单一 fixed 组的版本 = 主应用清单的 version = 发版 tag 的来源 */
export const MAIN_APP_MANIFEST = 'apps/admin/package.json'

export const CHANGESET_DIR = path.join(REPO_ROOT, '.changeset')
export const LEDGER_PATH = path.join(CHANGESET_DIR, 'ledger.yaml')
export const PARKED_CHANGELOGS_DIR = path.join(CHANGESET_DIR, 'changelogs')

function readManifestVersion(manifestPath: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: string }
    return manifest.version ?? null
  }
  catch {
    return null
  }
}

/** 工作区当前的版本（读 `apps/admin/package.json`） */
export function currentVersion(): string {
  const version = readManifestVersion(path.join(REPO_ROOT, MAIN_APP_MANIFEST))
  if (!version)
    throw new PreconditionError(`读不到 ${MAIN_APP_MANIFEST} 的 version —— 发版 tag 的来源就是它`)
  return version
}

/** 某个 ref 上的版本（打标前复核 HEAD 用） */
export function versionAtRef(ref: string): string | null {
  const content = fileAtRef(ref, MAIN_APP_MANIFEST)
  if (!content)
    return null
  try {
    return (JSON.parse(content) as { version?: string }).version ?? null
  }
  catch {
    return null
  }
}

/** fixed 组里没对齐到 `version` 的包（非空 = 半升级工作区，不可发版） */
export function packagesNotAtVersion(version: string): string[] {
  const misaligned: string[] = []
  for (const pkg of versionedPackages()) {
    const actual = readManifestVersion(path.join(REPO_ROOT, pkg.dir, 'package.json'))
    if (actual !== version)
      misaligned.push(`${pkg.name}（${actual ?? '无版本'}）`)
  }
  return misaligned
}

/** 当前工作区版本号一致的包名清单（`--status` 展示用） */
export function packagesAtVersion(version: string): string[] {
  return versionedPackages()
    .filter(pkg => readManifestVersion(path.join(REPO_ROOT, pkg.dir, 'package.json')) === version)
    .map(pkg => pkg.name)
}

// ── 意图 ──────────────────────────────────────────────────────────────────

export function isIntentFile(fileName: string): boolean {
  return fileName.endsWith('.md') && fileName !== 'README.md'
}

/** 盘上的意图文件名（未排序，调用方按需排序） */
export function intentFilesOnDisk(): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(CHANGESET_DIR)
  }
  catch {
    return []
  }
  return entries.filter(isIntentFile)
}

/** 读盘上的全部意图（读不动的跳过：格式问题由 `pnpm change status` 报） */
export function readIntents(): Intent[] {
  const intents: Intent[] = []
  for (const file of intentFilesOnDisk()) {
    try {
      const parsed = parseIntent(file, fs.readFileSync(path.join(CHANGESET_DIR, file), 'utf8'))
      if (parsed)
        intents.push(parsed)
    }
    catch {
      continue
    }
  }
  return intents.sort((a, b) => a.file.localeCompare(b.file))
}

export interface LedgerEntry {
  /** ledger 的键：`"@walnut/admin@0.1.0"` */
  key: string
  version: string
  dir: string | null
  /** 该版本消费掉的意图 id（不含 `.md`） */
  intents: string[]
}

/**
 * 读 `.changeset/ledger.yaml` —— pnpm 写的**消费台账**，append-only、随仓库提交。
 *
 * 为什么一切都以它为准（而不是「文件还在不在」）：`changelog.storage: registry` 模式下 pnpm
 * **不会**回收已消费的意图文件（回收要等 registry 确认该版本已带 changelog 发布，而本仓包全
 * private、从不 publish ⇒ 永不回收）。所以「文件还在」既可能是没消费、也可能是消费了没删干净；
 * 只有 ledger 能分辨。缺文件 = 空台账（首次发版前的正常状态），不是错误。
 */
export function readLedger(): LedgerEntry[] {
  let raw: string
  try {
    raw = fs.readFileSync(LEDGER_PATH, 'utf8')
  }
  catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  }
  catch (error: any) {
    throw new PreconditionError(`.changeset/ledger.yaml 不是合法 YAML：${error?.message ?? error}`)
  }
  if (!parsed || typeof parsed !== 'object')
    return []
  const entries: LedgerEntry[] = []
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const at = key.lastIndexOf('@')
    const version = at > 0 ? key.slice(at + 1) : ''
    const record = (value ?? {}) as Record<string, unknown>
    const intents = Array.isArray(record.intents)
      ? record.intents.map(item => String(item).replace(/\.md$/, ''))
      : []
    entries.push({
      key,
      version,
      dir: typeof record.dir === 'string' ? record.dir : null,
      intents,
    })
  }
  return entries
}

/** 已被 ledger 记账的意图 id 集合（任何版本） */
export function consumedIntentIds(): Set<string> {
  const ids = new Set<string>()
  for (const entry of readLedger()) {
    for (const id of entry.intents)
      ids.add(id)
  }
  return ids
}

/**
 * **真正还没被消费**的意图 id —— 判据是 ledger，不是文件是否存在。
 * 返回值排序稳定，便于日志与断言。
 */
export function unconsumedIntents(): string[] {
  const consumed = consumedIntentIds()
  return intentFilesOnDisk()
    .map(file => file.replace(/\.md$/, ''))
    .filter(id => !consumed.has(id))
    .sort()
}

/** 某个版本消费掉了哪些意图（用于把「变更条目」补出来显示） */
export function intentsOfVersion(version: string): string[] {
  const ids: string[] = []
  for (const entry of readLedger()) {
    if (entry.version === version)
      ids.push(...entry.intents)
  }
  return [...new Set(ids)].sort()
}

export interface CollectedIntents {
  /** 删掉的已消费意图文件名 */
  intents: string[]
  /** 清掉的 pnpm 寄存段落个数 */
  parked: number
}

/**
 * 收走消费后的残留：① 已记账的意图文件；② pnpm 的 `.changeset/changelogs/` 寄存区。
 *
 * ⚠️ 为什么由我们删：registry 模式下 pnpm **不回收**（理由见 `readLedger` 的注释）。
 * 不收就会在每次发版时堆一批，并随 release commit 进仓库。判据仍在 ledger，
 * 所以删文件不影响「消费过没有」这个判断。
 *
 * ⚠️ 顺序要紧：必须在写 changelog **之前**调它，否则本次 release commit 的 `git add -A`
 * 会把刚收走的那些文件又卷进来。
 */
export function deleteConsumedIntents(): CollectedIntents {
  const consumed = consumedIntentIds()
  const removed: string[] = []
  for (const file of intentFilesOnDisk()) {
    const id = file.replace(/\.md$/, '')
    if (!consumed.has(id))
      continue
    try {
      fs.unlinkSync(path.join(CHANGESET_DIR, file))
      removed.push(file)
    }
    catch {
      // 删不掉就当没删：下一次 `git add -A` 会把它带进提交，但不影响正确性
    }
  }

  let parked = 0
  let parkedEntries: string[] = []
  try {
    parkedEntries = fs.readdirSync(PARKED_CHANGELOGS_DIR)
  }
  catch {
    parkedEntries = []
  }
  if (parkedEntries.length > 0) {
    parked = parkedEntries.length
    try {
      fs.rmSync(PARKED_CHANGELOGS_DIR, { recursive: true, force: true })
    }
    catch {
      parked = 0
    }
  }

  return { intents: removed.sort(), parked }
}

// ── 「发版自己会改的文件」 ───────────────────────────────────────────────────

/**
 * 这个文件是不是本次发版自己会改的（⇒ 不该被算成「无关改动」）。
 * 判据：`.changeset/**`、根 `changelog-latest.md`、以及各包的 `CHANGELOG.md` 与版本号清单。
 */
export function isNotReleaseOwned(file: string): boolean {
  const normalized = file.replace(/\\/g, '/')
  if (normalized.startsWith('.changeset/'))
    return true
  if (normalized === 'changelog-latest.md')
    return true
  if (normalized.endsWith('/CHANGELOG.md'))
    return true
  for (const pkg of versionedPackages()) {
    if (normalized === `${pkg.dir}/package.json`)
      return true
  }
  return false
}

/** 从一批脏文件里滤出「与发版无关」的那些 */
export function unrelatedChanges(files: string[]): string[] {
  return files.filter(file => !isNotReleaseOwned(file)).sort()
}

/** 工作区里是否存在任何未被跟踪的**代码**（`--status` 展示用） */
export function trackedFileCount(): number {
  try {
    return lsFilesStrict('*').length
  }
  catch {
    return 0
  }
}
