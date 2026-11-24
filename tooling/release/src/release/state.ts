/**
 * 续跑**写前日志**（`.changeset/.release-state.json`，gitignored）。
 *
 * 为什么是「写前」：每步动作**之前**先把「下次该从哪继续」落盘，这样 Ctrl+C / 崩溃之后
 * 至少能说清停在哪。它的作用**只在改善提示**：真正的断点判定由 plan.ts 从可观测事实算出，
 * 所以这个文件丢了、或换了一台机器，续跑依然正确（只是原因说明会退化成「按事实推断」）。
 *
 * 唯一被它影响行为的地方：`consume-intents` 那一档会读取上次确认的 `bump` 与 `toVersion`，
 * 省掉重答一次 —— 这两个值不写盘也不会让流程算错（版本号由 pnpm 消费意图决定）。
 *
 * `--dry-run` 下全部写操作是 no-op：那是「零写盘演练」的定义。
 */

import type { Bump } from './intents.ts'
import type { ReleaseStep } from './plan.ts'
import fs from 'node:fs'
import path from 'node:path'
import { readJson, writeJson } from '@walnut/scripts/lib/json-file'
import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'

const STATE_PATH = path.join(REPO_ROOT, '.changeset', '.release-state.json')

export interface ReleaseState {
  version: 1
  startedAt: string
  updatedAt: string
  /** 开跑时的 HEAD（诊断用） */
  baseCommit: string | null
  /** 开跑时的上一个 tag */
  baseTag: string | null
  fromVersion: string
  toVersion: string
  bump: Bump
  branch: string
  /** 下次该从哪继续 */
  nextStep: ReleaseStep
  /** 本次是否跳过了门禁（事后审计） */
  gatesSkipped: string | null
}

let dryRun = false

/** CLI 在参数解析之后调用一次；`--dry-run` 会让本模块所有写操作变成 no-op */
export function setStateDryRun(value: boolean): void {
  dryRun = value
}

export function readState(): ReleaseState | null {
  const raw = readJson<ReleaseState>(STATE_PATH)
  if (!raw || typeof raw !== 'object')
    return null
  if (raw.version !== 1)
    return null
  return raw
}

/** 写「下次从哪继续」。`--dry-run` 下 no-op。 */
export function writeState(patch: Omit<ReleaseState, 'version' | 'startedAt' | 'updatedAt' | 'baseCommit' | 'baseTag' | 'branch' | 'gatesSkipped'> & {
  baseCommit?: string | null
  baseTag?: string | null
  branch?: string
  gatesSkipped?: string | null
}): void {
  if (dryRun)
    return
  const now = new Date().toISOString()
  const previous = readState()
  const next: ReleaseState = {
    version: 1,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    baseCommit: patch.baseCommit ?? previous?.baseCommit ?? null,
    baseTag: patch.baseTag ?? previous?.baseTag ?? null,
    fromVersion: patch.fromVersion,
    toVersion: patch.toVersion,
    bump: patch.bump,
    branch: patch.branch ?? previous?.branch ?? '',
    nextStep: patch.nextStep,
    gatesSkipped: patch.gatesSkipped ?? previous?.gatesSkipped ?? null,
  }
  writeJson(STATE_PATH, next)
}

export function clearState(): void {
  if (dryRun)
    return
  try {
    fs.unlinkSync(STATE_PATH)
  }
  catch {
    // 本来就不存在 ⇒ 已是目标状态
  }
}
