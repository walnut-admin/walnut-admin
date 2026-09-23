/**
 * 第 3 步：消费意图 —— `pnpm version -r --no-git-checks`，带**有界预算 + 重试 + 半写入守卫**。
 *
 * 为什么必须给预算与重试：这条命令会改 12 个 manifest 并写 ledger，是本流程**唯一的多文件写盘序列**。
 * 网络不稳（lockfile 核验 / 元数据抓取）会让它挂住；直接判失败会逼人重跑，而重跑要先判断
 * 「上次到底写没写」。
 *
 * 半写入守卫是本模块存在的核心理由：Ctrl+C / 超时可能停在「只写了一半 manifest」的位置 ——
 * 那时 apps/admin 可能已是新版本、而别的包还在旧版本。这个状态**不可重试**（重试会在已 bump 的
 * 版本上再 bump 一档），所以只允许在「一个包都没动」时重试，否则 `die(2)` 让人去 `git checkout -- .`。
 *
 * `--no-git-checks` 是必需的：本流程刚生成完意图，工作区必然有未提交改动，pnpm 默认的 git 检查
 * 会直接拒绝。
 */

import type { ReleaseArgs } from './args.ts'
import type { ReleaseUi } from './ui.ts'
import { PreconditionError } from '../lib/errors.ts'
import { currentVersion, packagesNotAtVersion } from './workspace.ts'

const CONSUME_TIMEOUT_ENV = 'CONSUME_TIMEOUT_MS'
const CONSUME_TIMEOUT_DEFAULT_MS = 3 * 60 * 1000

export interface ConsumeInput {
  oldVersion: string
  newVersion: string
}

/**
 * 消费意图。成功返回后不变量：**fixed 组全组已对齐到同一个版本**。
 */
export async function consumeIntents(ui: ReleaseUi, args: ReleaseArgs, input: ConsumeInput): Promise<string> {
  const attempts = args.consumeAttempts
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1)
      ui.warn(`消费意图重试 ${attempt}/${attempts} …`)

    try {
      await ui.runPnpmStep(
        ['version', '-r', '--no-git-checks'],
        `pnpm version -r --no-git-checks（v${input.oldVersion} → v${input.newVersion}，${attempt}/${attempts}）`,
      )
      lastError = null
      break
    }
    catch (error: any) {
      lastError = error

      // ── 半写入守卫 ────────────────────────────────────────────────────────
      // 判据：apps/admin 的版本是否已经离开基线。已经动了 ⇒ 说明这是一次**部分写入**，
      // 绝不重试（重试会在已 bump 的版本上再 bump 一档，打出一个错版本号的 tag）。
      let moved: string | null = null
      try {
        const now = currentVersion()
        if (now !== input.oldVersion)
          moved = now
      }
      catch {
        moved = null
      }

      if (moved !== null) {
        const misaligned = packagesNotAtVersion(moved)
        ui.log('❌ 消费意图中途失败，且工作区**已经部分写入**：')
        ui.log(`   已到 v${moved}`)
        for (const item of misaligned.slice(0, 20))
          ui.log(`   · 仍在旧版本：${item}`)
        if (misaligned.length > 20)
          ui.log(`   · … 另有 ${misaligned.length - 20} 个`)
        ui.die(2, `工作区处于「半升级」状态（不是可发版状态）。拒绝重试：在已 bump 的版本上再 bump 一档会打出错的 tag。`
        + '修法：git checkout -- . 把改动全部还原，重跑 pnpm release（意图会按需重新生成）。')
      }

      const isLast = attempt === attempts
      if (isLast)
        break

      ui.warn(`pnpm version -r 失败（一个包都没动，可安全重试）：${(error as Error)?.message?.split('\n')[0] ?? error}`)
    }
  }

  if (lastError !== null) {
    throw new PreconditionError(
      `pnpm version -r 连续 ${attempts} 次失败，且每次都没有改动任何包。\n`
      + `   ${(lastError as Error)?.message ?? lastError}\n`
      + `   已落盘的改动保留（若一个包都没动，则工作区仍是干净的）；提高重试次数：--consume-attempts <n>；`
      + `单条预算经 ${CONSUME_TIMEOUT_ENV} 调整（默认 ${CONSUME_TIMEOUT_DEFAULT_MS / 60000} 分钟）。`,
    )
  }

  // ── 消费后的全组对齐校验 ────────────────────────────────────────────────
  const consumedVersion = currentVersion()
  const drift = packagesNotAtVersion(consumedVersion)
  if (drift.length > 0) {
    ui.die(1, `消费意图后 fixed 组没有对齐到同一个版本（基准 v${consumedVersion}）：`
    + `\n   · ${drift.join('\n   · ')}`
    + '\n   这说明 pnpm 的 fixed 组计算结果与实际写盘不一致（或有人并发改了 manifest）。'
    + '请先查清再重跑；放弃本次发版：git checkout -- .')
  }

  if (consumedVersion === input.oldVersion) {
    ui.log(`版本号未变更（仍是 v${consumedVersion}）—— 没有意图提及任何包`)
  }
  else {
    ui.log(`版本已消费：v${input.oldVersion} → v${consumedVersion}（全组 12 个包已对齐）`)
  }

  return consumedVersion
}

/** 消费步骤的超时预算（给 ui.childOptions 用） */
export const consumeTimeout = {
  env: CONSUME_TIMEOUT_ENV,
  defaultMs: CONSUME_TIMEOUT_DEFAULT_MS,
}
