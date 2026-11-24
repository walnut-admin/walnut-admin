/**
 * GitHub 的**纯判定面**：remote 解析、token 掩码、API 地址、网页 Release 链接、凭据读取口径。
 *
 * 为什么下沉到这里：这五个东西被两个包同时需要 —— 发版编排（`@walnut/release` 的 Release 查询）
 * 与文档站版本刷新（`@walnut/scripts` 的 `docs:version`）。各写一份正则与掩码，迟早会漂。
 * 本模块不做任何 I/O（`apiBase` 读 `GITHUB_API_URL` 是唯一的进程环境接触点，与迁移前一致），
 * 不认识「发版」「文档站」这些业务概念。
 *
 * 失败口径：解析不出返回 `null`，由调用方决定是抛前置条件还是跳过 —— 本模块不替它们决定退出码。
 * 凭据：token 只做掩码与来源标注，**从不打印明文**；HTTP 层把 token 放进 Authorization 头，
 * 绝不拼进 URL（查询串会留在各层访问日志里）。
 */

import process from 'node:process'

export interface GithubRepo {
  owner: string
  repo: string
  /** 默认 github.com；GitHub Enterprise 可换域名 */
  host: string
}

/** 从环境变量读 token 的结果：值只在这里出现一次，日志里只用 `source` 加掩码 */
export interface EnvToken {
  token: string | null
  source: 'GITHUB_TOKEN' | 'GH_TOKEN' | null
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

/**
 * 凭据读取的**唯一口径**：`GITHUB_TOKEN` 优先，`GH_TOKEN`（gh CLI 的惯例名）回退。
 *
 * env 做成参数是为了可测（用例不必改 `process.env`）；默认值仍是进程环境。
 * trim 后为空的变量等于没给 —— 空串拼进 `Bearer` 头会得到一个 401，比「匿名查询」更难查。
 */
export function tokenFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): EnvToken {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN'] as const) {
    const value = env[name]?.trim()
    if (value)
      return { token: value, source: name }
  }
  return { token: null, source: null }
}
