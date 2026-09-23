/**
 * 写仓库根的 `changelog-latest.md` —— **GitHub Release 正文的唯一来源**。
 *
 * 为什么是「本地生成 + 随 release commit 提交」这条路线（而不是本地调 API 建 Release）：
 *   ① `.github/workflows/release.yml` 的 release job 已经用 `body_path: changelog-latest.md`
 *      读这个文件，所以**不用改 workflow**；
 *   ② 正文随 release commit 进仓库 ⇒ CI checkout 到该 tag 时读到的就是本次的正文，
 *      而且事后重跑 / 回滚重发旧 tag 能复现同一份正文；
 *   ③ 发版机因此**不需要**任何能改远端内容的凭据。
 *
 * ⚠️ 反过来说：这个文件**必须**在打 tag 之前写盘并进提交。漏了它，CI 会读到上一个版本留下的
 * 内容（或读不到）—— Release 正文与本次发版对不上，而且是静默的。
 *
 * 幂等：内容一致就不重写（断点续跑会重跑本步骤，不幂等会让文件的时间戳每次都变）。
 */

import type { ReleaseUi } from './ui.ts'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { assertCliffRemoteMatches, renderReleaseNotes } from './changelog.ts'
import { buildReleaseNotes, releaseNoteSource } from './plan.ts'

/** 与 `release.yml` 的 `body_path` 对齐；**改这个路径必须同时改 workflow */
export const RELEASE_NOTES_FILE = 'changelog-latest.md'
export const RELEASE_NOTES_PATH = path.join(REPO_ROOT, RELEASE_NOTES_FILE)

export interface WriteNotesInput {
  version: string
  summaries: { packages: string[], summary: string }[]
  dryRun?: boolean
}

export interface WriteNotesOutcome {
  action: 'written' | 'unchanged' | 'preview'
  source: 'cliff' | 'intents' | 'placeholder'
  file: string
}

export async function writeReleaseNotes(ui: ReleaseUi, input: WriteNotesInput): Promise<WriteNotesOutcome> {
  const { version, summaries, dryRun = false } = input

  // 链接是字面量 ⇒ 发版前必须确认 cliff.toml 与实际 remote 一致（不一致则 die(1)）
  assertCliffRemoteMatches()

  const cliffNotes = await renderReleaseNotes(version)
  const noteInput = { version, cliffNotes, summaries }
  const source = releaseNoteSource(noteInput)
  const body = buildReleaseNotes(noteInput)

  ui.log(`   Release 正文来源：${source}`
    + `${source === 'cliff' ? '（整仓本次发版的 git-cliff 渲染）' : source === 'intents' ? '（cliff 渲不出来，退回意图摘要）' : '（没有条目）'}`)

  let existing = ''
  try {
    existing = fs.readFileSync(RELEASE_NOTES_PATH, 'utf8')
  }
  catch {
    existing = ''
  }

  if (existing === body) {
    ui.log(`   ${RELEASE_NOTES_FILE} 内容未变，跳过写入`)
    return { action: 'unchanged', source, file: RELEASE_NOTES_FILE }
  }

  if (dryRun) {
    ui.banner([
      `  🧪 --dry-run：${RELEASE_NOTES_FILE} 预览（${source}）`,
      '',
      ...body.split('\n').slice(0, 20).map(line => `   ${line}`),
    ])
    return { action: 'preview', source, file: RELEASE_NOTES_FILE }
  }

  fs.writeFileSync(RELEASE_NOTES_PATH, body)
  ui.log(`   ${RELEASE_NOTES_FILE} 已更新（${source}）—— 会随 release commit 提交，CI 的 Release 正文读它`)
  return { action: 'written', source, file: RELEASE_NOTES_FILE }
}
