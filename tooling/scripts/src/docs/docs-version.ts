/**
 * `pnpm walnut docs:version` —— 刷新文档站导航栏显示的版本号（`apps/docs/version.json`）。
 *
 * ## 它取代了什么
 *
 * 旧脚本 `apps/docs/scripts/fetch-version.js` 写死了**旧仓库** `walnut-admin/walnut-admin-client`，
 * 仓库里没有任何地方调用它，`version.json` 因此停在旧仓库时代的号上。现在版本号从**本仓**的
 * `git remote origin` 推出来，仓库搬家不会再悄悄查错地方。
 *
 * ## 取值顺序
 *
 * 1. `GET /repos/<owner>/<repo>/releases/latest`：200 且 `tag_name` 非空 → 用它（**原样写入**，
 *    不加减 `v` 前缀 —— 发布时写的是什么就是什么）。
 * 2. 404（一个 Release 都没建过）→ 回退到**本机最新 tag**（`git tag --sort=-v:refname` 的第一个）。
 *    不用 GitHub 的 tags 接口：那个接口按提交时间排序，不是版本序。
 * 3. 其它情况（非 200 / 网络错误 / 超时 / 响应体不是 JSON / `tag_name` 为空）→ `PreconditionError`
 *    （退出码 2）：这是「环境或输入没准备好」，不是检出违规。
 *
 * 凭据只走 `Authorization` 头，**不进 URL、不进任何输出**；读取口径复用
 * `lib/github.ts` 的 `tokenFromEnv`（`GITHUB_TOKEN` > `GH_TOKEN`），与发版编排同一处。
 *
 * 判定逻辑拆成可测的纯函数（`decideVersion` / `latestTagFromBody` / `localLatestTag`），
 * 网络与文件 IO 留在薄的边缘（`lookupLatestRelease` / `runDocsVersion`）。
 */

import type { GithubRepo } from '../lib/github.ts'
import { join } from 'node:path'

import { PreconditionError } from '../lib/errors.ts'
import { gitRemoteUrl, tagsByVersion } from '../lib/git.ts'
import { apiBase, parseGithubRemote, tokenFromEnv } from '../lib/github.ts'
import { readJson, writeJson } from '../lib/json-file.ts'
import { line } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 超时：查一个公开 API 不该等更久；超时按「查询失败」处理，不重试（限流 60 次/小时） */
const TIMEOUT_MS = 15_000
/** GitHub 官方的 API 版本头；不变更它就永远走稳定的响应形状 */
const API_VERSION = '2022-11-28'
/** 错误体截断长度：避免把整页 HTML 打进日志 */
const BODY_SNIPPET_LIMIT = 300

/** 版本号从哪来（日志里要说得出来） */
export type DocsVersionSource = 'release' | 'local-tag'

/** 一次 HTTP 查询的两种结果：拿到响应（含非 200）或压根没发出去 */
export type ReleaseLookup =
  | { ok: true; status: number; body: string }
  | { ok: false; reason: string }

export interface DocsVersionInput {
  /** `git remote get-url origin`；null = 读不到（不在检出内 / 没配 origin） */
  remoteUrl: string | null
  /** `git tag --sort=-v:refname` 的顺序：404 回退时取第一个非空项 */
  localTags: readonly string[]
  /** GitHub token；null = 匿名查询（公开仓限流 60 次/小时） */
  token: string | null
  /** 目标文件（绝对路径；测试注入临时目录） */
  versionFile: string
}

export interface DocsVersionResult {
  /** 刷新前的值（读不到 / 形状不对时为 null） */
  previous: string | null
  version: string
  source: DocsVersionSource
  file: string
}

/** 目标文件的位置（相对仓库根，不依赖调用方的 cwd） */
export const DOCS_VERSION_FILE = join(REPO_ROOT, 'apps/docs/version.json')

/**
 * 从 remote 解析仓库坐标。解析不出就抛前置条件错误，并把**支持的形态**写进消息 ——
 * 这条命令最常见的失败是「在错误的目录里跑」，消息要能自己回答「那我该配成什么样」。
 */
export function resolveRepo(remoteUrl: string | null): GithubRepo {
  if (remoteUrl === null || remoteUrl.trim() === '')
    throw new PreconditionError(
      '读不到 git remote `origin`：请在仓库检出内运行，或先 `git remote add origin <url>`。',
    )
  const repo = parseGithubRemote(remoteUrl)
  if (repo === null) {
    throw new PreconditionError(
      `无法从 git remote 解析出 GitHub 仓库坐标：${remoteUrl}\n` +
        '支持的形态：https://<host>/<owner>/<repo>(.git)、git@<host>:<owner>/<repo>(.git)（含企业域名）。',
    )
  }
  return repo
}

/** 响应体 → tag。不是 JSON / 不是对象 / `tag_name` 不是非空字符串 ⇒ null */
export function latestTagFromBody(body: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const tag = (raw as Record<string, unknown>).tag_name
  if (typeof tag !== 'string') return null
  const trimmed = tag.trim()
  return trimmed === '' ? null : trimmed
}

/** 本机最新 tag（列表已按 `-v:refname` 排好序）；一个都没有就抛前置条件错误 */
export function localLatestTag(localTags: readonly string[]): string {
  const first = localTags.map((tag) => tag.trim()).find(Boolean)
  if (first === undefined)
    throw new PreconditionError(
      'GitHub 仓库还没有任何 Release（HTTP 404），本机也没有任何 tag：先打一个 tag 或建一个 Release，再重跑。',
    )
  return first
}

/** 错误体压成一行并截断（日志与消息里不放整页 HTML） */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= BODY_SNIPPET_LIMIT ? flat : `${flat.slice(0, BODY_SNIPPET_LIMIT)}…`
}

/**
 * 判定该写哪个版本（纯函数）：给定 HTTP 结果与本机 tag 列表，返回版本与来源，或抛前置条件错误。
 */
export function decideVersion(
  lookup: ReleaseLookup,
  localTags: readonly string[],
): { version: string; source: DocsVersionSource } {
  if (!lookup.ok)
    throw new PreconditionError(`查询 GitHub 最新 Release 失败（网络错误或超时）：${lookup.reason}`)
  if (lookup.status === 200) {
    const tag = latestTagFromBody(lookup.body)
    if (tag !== null) return { version: tag, source: 'release' }
    throw new PreconditionError(
      `GitHub API 返回 200，但响应体里没有有效的 tag_name（不是 JSON、或字段为空）：${snippet(lookup.body)}`,
    )
  }
  if (lookup.status === 404) return { version: localLatestTag(localTags), source: 'local-tag' }
  throw new PreconditionError(`GitHub API 返回 HTTP ${lookup.status}：${snippet(lookup.body)}`)
}

/** 请求头：凭据只走 Authorization 头，不进 URL */
function requestHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'walnut-admin-docs-version',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * 查最新 Release。网络错误 / 超时收敛成 `{ ok: false }`（由 `decideVersion` 统一翻译成前置条件错误），
 * 非 200 的响应体照样带回 —— 截断与判据都留给调用方。
 */
async function lookupLatestRelease(
  repo: GithubRepo,
  token: string | null,
  fetchImpl: typeof fetch,
): Promise<ReleaseLookup> {
  const url = `${apiBase(repo)}/repos/${repo.owner}/${repo.repo}/releases/latest`
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: requestHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return { ok: true, status: response.status, body: await response.text() }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** 旧值（文件不存在 / 不是对象 / `version` 不是字符串都算「读不到」，不抛） */
function previousVersion(file: string): string | null {
  const raw = readJson<Record<string, unknown>>(file)
  const value = raw?.version
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 刷新版本号：remote → HTTP → 判定 → 写文件。返回新旧值与来源，**不打印**。
 *
 * `fetchImpl` 是参数而不是直接读全局：用例用 `vi.stubGlobal('fetch', …)` 注入，
 * 本函数本身仍走真实实现（默认值）。
 */
export async function runDocsVersion(
  input: DocsVersionInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DocsVersionResult> {
  const repo = resolveRepo(input.remoteUrl)
  const lookup = await lookupLatestRelease(repo, input.token, fetchImpl)
  const { version, source } = decideVersion(lookup, input.localTags)
  const previous = previousVersion(input.versionFile)
  writeJson(input.versionFile, { version })
  return { previous, version, source, file: input.versionFile }
}

/** bin 的入口：真实 git / env / 文件，结论一行到 stdout */
export async function main(): Promise<void> {
  const { token } = tokenFromEnv()
  const result = await runDocsVersion({
    remoteUrl: gitRemoteUrl(),
    localTags: tagsByVersion(),
    token,
    versionFile: DOCS_VERSION_FILE,
  })
  const from =
    result.source === 'release' ? 'GitHub 最新 Release' : '本机最新 tag（仓库还没有 Release）'
  line('ok', `文档站版本号：${result.previous ?? '(无)'} → ${result.version}（来源：${from}）`)
}
