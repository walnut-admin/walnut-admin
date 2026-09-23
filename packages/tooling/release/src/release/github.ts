/**
 * GitHub REST —— **只读**：查「某个 tag 有没有 Release」。
 *
 * ⚠️ 本模块刻意**不**建、不改 Release。建 Release 是 `.github/workflows/release.yml` 的职责
 * （tag 推送触发，走 `softprops/action-gh-release`）。本地要的只是一个只读事实，好让
 * `--status` 能说出「标签已发布、Release 还没建」，而不是让发版机握着一个能改远端内容的凭据。
 *
 * 为什么用 fetch 而不是引依赖：Node 24 自带 fetch，而本仓依赖一律走 catalog（引一个新包要改
 * `pnpm-workspace.yaml` + 锁文件）；这里只需要 1 个 HTTP 调用，不值得换一个依赖进来。
 *
 * 失败口径：5xx 与超时按 `RETRY_DELAYS_MS` 退避重试，4xx 立即交给调用方（确定性失败，重试无意义）。
 * 「没有 Release」与「查不到」必须分开：前者是 404 / 空响应体，后者是抛异常 ——
 * 把查询失败当成「没有」会让续跑阶梯误判。
 */

import process from 'node:process'

const TIMEOUT_MS = 15_000
/** GitHub 官方的 API 版本头；不变更它就永远走稳定的响应形状 */
const API_VERSION = '2022-11-28'

export interface GithubRepo {
  owner: string
  repo: string
  /** 默认 github.com；GitHub Enterprise 可换域名 */
  host: string
}

export interface GithubRelease {
  id: number
  tagName: string
  name: string
  body: string
  url: string
  draft: boolean
  prerelease: boolean
}

export interface GithubClient {
  /** null = 未提供 token（公开仓可匿名查询，限流 60 次/小时） */
  token: string | null
  repo: GithubRepo
}

/**
 * 从 git remote 解析出 GitHub 仓库坐标。
 * 支持 `https://github.com/o/r.git`、`git@github.com:o/r.git`、企业域名、结尾无 `.git`。
 */
export function parseGithubRemote(url: string): GithubRepo | null {
  const trimmed = url.trim()
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (ssh)
    return { host: ssh[1]!, owner: ssh[2]!, repo: ssh[3]! }
  const http = /^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (http)
    return { host: http[1]!, owner: http[2]!, repo: http[3]! }
  return null
}

/** 日志里只出现 token 的头尾，避免整串进 CI 日志 / 截图 */
export function maskToken(token: string): string {
  if (token.length <= 8)
    return '****'
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}

/** github.com → api.github.com；企业域名 → `<host>/api/v3` */
export function apiBase(repo: GithubRepo): string {
  const override = process.env.GITHUB_API_URL?.trim()
  if (override)
    return override.replace(/\/+$/, '')
  if (repo.host === 'github.com' || repo.host === 'www.github.com')
    return 'https://api.github.com'
  return `https://${repo.host}/api/v3`
}

/** 网页地址（拼给人点的 Release 链接；API 不保证返回 html_url 的可用性） */
export function webReleaseUrl(repo: GithubRepo, tag: string): string {
  return `https://${repo.host}/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(tag)}`
}

function headers(client: GithubClient): Record<string, string> {
  const base: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'walnut-admin-release',
  }
  // 凭据一律走 Authorization 头，**不进 URL** —— 查询串会留在各层访问日志里
  if (client.token)
    base.Authorization = `Bearer ${client.token}`
  return base
}

/** 5xx / 超时重试：GitHub 偶发 5xx 时不必让人重跑；4xx 是确定性问题，立刻抛 */
const RETRY_DELAYS_MS = [500, 2000]
const RETRYABLE_STATUS = (status: number) => status >= 500

async function getOnce(client: GithubClient, path: string): Promise<{ ok: true, text: string } | { ok: false, status: number, text: string }> {
  const url = `${apiBase(client.repo)}/repos/${client.repo.owner}/${client.repo.repo}${path}`
  const response = await fetch(url, {
    method: 'GET',
    headers: headers(client),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  return response.ok ? { ok: true, text } : { ok: false, status: response.status, text }
}

async function get(client: GithubClient, path: string): Promise<unknown> {
  let text = ''
  for (let attempt = 0; ; attempt++) {
    let outcome: { ok: true, text: string } | { ok: false, status: number, text: string }
    try {
      outcome = await getOnce(client, path)
    }
    catch (error: any) {
      // 超时 / 网络错误同样重试；用尽后原样抛出（调用方按「查询失败」处理）
      if (attempt >= RETRY_DELAYS_MS.length)
        throw error
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
      continue
    }
    if (outcome.ok) {
      text = outcome.text
      break
    }
    if (outcome.status === 404)
      throw new NotFoundError(path)
    if (!RETRYABLE_STATUS(outcome.status) || attempt >= RETRY_DELAYS_MS.length) {
      // 错误体截断到 300 字，避免把整页 HTML 打进日志
      throw new Error(`GitHub API GET ${path} 失败：HTTP ${outcome.status} ${outcome.text.slice(0, 300)}`)
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
  }
  if (text.trim() === '')
    return null
  try {
    return JSON.parse(text)
  }
  catch {
    throw new Error(`GitHub API GET ${path} 返回的不是 JSON：${text.slice(0, 120)}`)
  }
}

/** 内部信号：路径不存在（调用方把它翻译成 null，而不是错误） */
class NotFoundError extends Error {
  constructor(path: string) {
    super(`GitHub 404：${path}`)
    this.name = 'NotFoundError'
  }
}

/** 把 API 返回体收口成 Release；**null / 非对象 / 缺 id 一律返回 null */
function toReleaseOrNull(raw: unknown): GithubRelease | null {
  if (raw === null || typeof raw !== 'object')
    return null
  const record = raw as Record<string, unknown>
  if (record.id === null || record.id === undefined || record.id === '')
    return null
  return {
    id: Number(record.id),
    tagName: String(record.tag_name ?? ''),
    name: String(record.name ?? ''),
    body: String(record.body ?? ''),
    url: String(record.html_url ?? ''),
    draft: Boolean(record.draft),
    prerelease: Boolean(record.prerelease),
  }
}

/**
 * 查某个 tag 的 Release。
 *
 * 返回 null 的三种情形都算「没有这个 Release」，都**不是**错误：
 *   ① HTTP 404（GitHub 的标准答复）；
 *   ② 200 + 空响应体；
 *   ③ 响应体是对象但没有 `id`。
 * 网络故障 / 5xx 用尽重试则**抛**，调用方据此把 `releaseChecked` 置 false ——
 * 「查询失败」绝不能被当成「远端没有 Release」。
 */
export async function findRelease(client: GithubClient, tag: string): Promise<GithubRelease | null> {
  try {
    return toReleaseOrNull(await get(client, `/releases/tags/${encodeURIComponent(tag)}`))
  }
  catch (error: any) {
    if (error instanceof NotFoundError)
      return null
    if (/HTTP 404/.test(String(error?.message)))
      return null
    throw error
  }
}
