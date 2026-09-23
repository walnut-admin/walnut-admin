/**
 * 事实采集：把 git / 工作区 / ledger / 远端收成一个 `ReleaseFacts` —— 续跑阶梯的**唯一输入**。
 *
 * 为什么单独成模块：`--status` 与真正的发版必须看**同一份真相**。分头采集迟早会漂成
 * 「状态说能从总览续跑、真跑却走了另一个档」这种最难查的形态。
 *
 * 本模块不做的判断：不决定下一步（那是 plan.ts）、不写任何东西、不打印。
 */

import type { ReleaseFacts, ReleaseStep } from './plan.ts'
import path from 'node:path'
import { branchIsPushed, commitCount, currentBranch, gitRemoteUrl, headSubject, lastTag, porcelain, tagExistsLocally, tagExistsRemotely, trackedDirtyFiles } from '../lib/git.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { findRelease, parseGithubRemote } from './github.ts'
import { currentVersion, LEDGER_PATH, packagesNotAtVersion, readLedger, unconsumedIntents, unrelatedChanges, versionAtRef } from './workspace.ts'

/** release 提交的主题形状（`git log` 里认出「HEAD 就是本次 release 提交」） */
const RELEASE_COMMIT_PATTERN = /^chore\(release\):\s*v(\d+\.\d+\.\d+)$/

export interface CollectedFacts extends ReleaseFacts {
  /** 上一次运行留下的下一步（写前日志） */
  stateStep: ReleaseStep | null
  /** 工作区里与发版无关的脏文件（报告与拦截都用它） */
  unrelated: string[]
}

export interface CollateFactsInput {
  /** 状态文件里记的下一步（诊断 + 续跑提示用） */
  stateStep: ReleaseStep | null
  /**
   * 远端 Release 探测。
   * 返回 `true` / `false` = 查到了；返回 `null` = **查询失败**（不能当成「没有」）。
   * 不提供 ⇒ `releaseChecked` 为 false，`--status` 会说明「未查询」。
   */
  probeRemoteRelease?: ((tag: string) => Promise<boolean | null>) | undefined
}

/** `ledger.yaml` 是否有未提交改动（= 「版本已消费但没提交」，只作显示） */
function ledgerHasUncommittedChanges(): boolean {
  const relative = path.relative(REPO_ROOT, LEDGER_PATH).replace(/\\/g, '/')
  return porcelain(true).some(line => line.includes(relative))
}

export async function collateFacts(input: CollateFactsInput): Promise<CollectedFacts> {
  const branch = currentBranch()
  const version = currentVersion()
  const tag = `v${version}`

  const baseTag = lastTag()
  const baseVersion = baseTag ? versionAtRef(baseTag) : null

  const localTagExists = tagExistsLocally(tag)
  const remoteTagExists = tagExistsRemotely(tag)

  const headVersion = versionAtRef('HEAD')
  const subject = headSubject()
  const matched = subject ? RELEASE_COMMIT_PATTERN.exec(subject.trim()) : null

  let remoteReleaseExists = false
  let releaseChecked = false
  if (input.probeRemoteRelease) {
    const probe = await input.probeRemoteRelease(tag)
    if (probe !== null) {
      releaseChecked = true
      remoteReleaseExists = probe
    }
  }

  return {
    branch,
    currentVersion: version,
    baseTag,
    baseVersion,
    localTagExists,
    remoteTagExists,
    remoteReleaseExists,
    releaseChecked,
    branchPushed: branchIsPushed(branch),
    commitsSinceTag: commitCount(baseTag),
    stateStep: input.stateStep,
    pendingIntents: unconsumedIntents().length,
    versionConsumed: ledgerHasUncommittedChanges(),
    // 直接事实：HEAD 上的版本 ≠ 工作区版本 ⇒ 版本已 bump 但还没提交。不靠 ledger 脏度推测。
    bumpUncommitted: headVersion !== null && headVersion !== version,
    groupMisaligned: packagesNotAtVersion(version),
    releaseCommit: matched ? `v${matched[1]}` : null,
    unrelated: collectUnrelatedChanges(),
  }
}

/**
 * 构造「远端 Release 存在吗」的探测器。
 *
 * 不需要凭据也能查**公开仓**（匿名 60 次/小时）；有 GITHUB_TOKEN 时配额更高。
 * 探测失败返回 `null`（而不是 false）：把查询失败当成「远端没有 Release」会让阶梯误判。
 */
export function makeReleaseProbe(token: string | null): ((tag: string) => Promise<boolean | null>) | undefined {
  const remote = gitRemoteUrl()
  if (!remote)
    return undefined
  const repo = parseGithubRemote(remote)
  if (!repo)
    return undefined
  return async (tag: string) => {
    try {
      return (await findRelease({ token, repo }, tag)) !== null
    }
    catch {
      return null
    }
  }
}

/** 台账里已记了多少个版本（`--status` 展示与诊断） */
export function ledgerVersionCount(): number {
  return readLedger().filter(entry => entry.intents.length > 0).length
}

/** 工作区里与发版无关的改动（供编排与报告共用） */
export function collectUnrelatedChanges(): string[] {
  return unrelatedChanges(trackedDirtyFiles())
}
