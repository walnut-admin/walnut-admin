/**
 * 产物新鲜度：**最近一次源码提交** vs **两处 stage 产物的真实 mtime**。
 *
 * 它回答的是「这一轮跑的产物是不是最新源码构建出来的」。调查时点真实见过一种现场：
 * `dist-stage/apps/api/src/main.js` 比 `dist-staging/index.html` 旧一天，而 preflight 只做
 * `existsSync` —— 于是「登录框等不出来」「/auth/permissions 40101」这类现象被当成产品 bug 查。
 *
 * 口径（**只警告、不退出**）：
 * - `sourceCommitAt` = `git log -1 --format=%ct -- <源码路径>`，即最近一次改动被测源码的提交；
 * - `artifactAgeMinutes` = now − 产物 mtime（产物多旧）；
 * - `artifactLagMinutes` = max(0, 源码提交时刻 − 产物 mtime)（产物落后源码多少）。
 *
 * 为什么落后才警告、不直接判失败：本地存在「刚改完源码但只想验证旧产物」的合法场景
 * （排障时对比），而且 preflight 是环境前置检查 —— 把「可能不新」升级成退 2 会误伤这类用法。
 * 真正的判据交给 `stack.json` 的记录与失败现场附件。
 *
 * 为什么比较的是**提交时刻**而不是工作区 mtime：产物来自提交过的源码；未提交的改动本就不该
 * 被当作「产物已经包含它」。这也让读数稳定（不随 checkout / 编辑器保存抖动）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { ADMIN_INDEX_FILE, REPO_ROOT, SERVER_MAIN_FILE } from './env.ts'

/** 参与「最近源码提交」判定的路径（与被测产物同源的那几块） */
const SOURCE_PATHS = ['apps/admin/src', 'apps/server/apps', 'apps/server/libs', 'packages'] as const

export interface ArtifactFreshness {
  /** 最近一次源码提交的时刻（秒级 epoch）；读不到 git 时为 null */
  sourceCommitSeconds: number | null
  /** 同上（ISO 8601，便于人读）；null 表示读不到 */
  sourceCommitAt: string | null
  /** now − 产物 mtime（分钟）；产物缺失时为 null */
  artifactAgeMinutes: { adminIndex: number | null, serverMain: number | null }
  /** max(0, 源码提交时刻 − 产物 mtime)（分钟）；产物缺失或 git 读不到时为 null */
  artifactLagMinutes: { adminIndex: number | null, serverMain: number | null }
}

function lastSourceCommitSeconds(): number | null {
  try {
    const output = execFileSync(
      'git',
      ['log', '-1', '--format=%ct', '--', ...SOURCE_PATHS],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    ).trim()
    const seconds = Number.parseInt(output, 10)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }
  catch {
    // 浅克隆 / 非 git 环境：不阻断（新鲜度只是告警面，环境前置另有 preflight 的硬检查）
    return null
  }
}

function minutesBetween(laterMs: number, earlierMs: number): number {
  return Math.round((laterMs - earlierMs) / 60_000)
}

function ageMinutesOf(file: string, nowMs: number): number | null {
  if (!existsSync(file)) {
    return null
  }
  try {
    return Math.max(0, minutesBetween(nowMs, statSync(file).mtime.getTime()))
  }
  catch {
    return null
  }
}

function lagMinutesOf(file: string, sourceCommitSeconds: number | null): number | null {
  if (sourceCommitSeconds === null || !existsSync(file)) {
    return null
  }
  try {
    return Math.max(0, minutesBetween(sourceCommitSeconds * 1000, statSync(file).mtime.getTime()))
  }
  catch {
    return null
  }
}

/** 计算当前产物新鲜度（preflight 打印告警、stack-info 写进 stack.json） */
export function computeArtifactFreshness(nowMs = Date.now()): ArtifactFreshness {
  const sourceCommitSeconds = lastSourceCommitSeconds()
  return {
    sourceCommitSeconds,
    sourceCommitAt: sourceCommitSeconds === null ? null : new Date(sourceCommitSeconds * 1000).toISOString(),
    artifactAgeMinutes: {
      adminIndex: ageMinutesOf(ADMIN_INDEX_FILE, nowMs),
      serverMain: ageMinutesOf(SERVER_MAIN_FILE, nowMs),
    },
    artifactLagMinutes: {
      adminIndex: lagMinutesOf(ADMIN_INDEX_FILE, sourceCommitSeconds),
      serverMain: lagMinutesOf(SERVER_MAIN_FILE, sourceCommitSeconds),
    },
  }
}

export interface StaleArtifactNote {
  /** 产物名（人读） */
  name: string
  /** 落后源码的分钟数（> 0 才会产生 note） */
  lagMinutes: number
  /** 修复命令（只提示，不进失败判据） */
  fix: string
}

/**
 * 从新鲜度读数里挑出「落后源码」的产物（纯函数，单测直击）。
 * 顺序固定（admin 在前），与 preflight 的打印顺序一致。
 */
export function staleArtifacts(freshness: ArtifactFreshness): StaleArtifactNote[] {
  const notes: StaleArtifactNote[] = []
  const adminLag = freshness.artifactLagMinutes.adminIndex
  if (adminLag !== null && adminLag > 0) {
    notes.push({ name: 'apps/admin/dist-staging/index.html', lagMinutes: adminLag, fix: 'pnpm walnut build:stage' })
  }
  const serverLag = freshness.artifactLagMinutes.serverMain
  if (serverLag !== null && serverLag > 0) {
    notes.push({ name: 'apps/server/dist-stage/apps/api/src/main.js', lagMinutes: serverLag, fix: 'pnpm --filter @walnut/server build:stage' })
  }
  return notes
}
