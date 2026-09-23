/**
 * GitHub REST 只读面：远端解析、token 掩码、API base、Release 查询。
 *
 * 「没有 Release」与「查不到」必须分开（404 / 空响应体 = null；网络故障 = 抛），
 * 把查询失败当成「没有」会让续跑阶梯误判。凭据一律走 Authorization 头，**不进 URL**。
 */

import type { GithubRepo } from '../github.ts'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiBase, findRelease, maskToken, parseGithubRemote, webReleaseUrl } from '../github.ts'

const originalApiUrl = process.env.GITHUB_API_URL

const REPO: GithubRepo = { host: 'github.com', owner: 'o', repo: 'r' }

interface StubResponse {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function responseOf(body: string, status = 200): StubResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

/** 装上 fetch 桩并返回它（调用参数供检查 URL / init） */
function stubFetch(response: StubResponse) {
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  delete process.env.GITHUB_API_URL
})

afterEach(() => {
  if (originalApiUrl === undefined)
    delete process.env.GITHUB_API_URL
  else
    process.env.GITHUB_API_URL = originalApiUrl
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseGithubRemote', () => {
  it('https 形态（带 / 不带 .git、带结尾斜杠）', () => {
    expect(parseGithubRemote('https://github.com/o/r.git')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseGithubRemote('https://github.com/o/r')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseGithubRemote('https://github.com/o/r/')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
  })

  it('scp 形态（git@host:owner/repo.git）', () => {
    expect(parseGithubRemote('git@github.com:o/r.git')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseGithubRemote('git@github.com:o/r')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
    expect(parseGithubRemote('ssh://git@github.com/o/r.git')).toEqual({ host: 'github.com', owner: 'o', repo: 'r' })
  })

  it('企业域名（host 原样保留，apiBase 据此换路径）', () => {
    expect(parseGithubRemote('https://git.corp.example.com/team/repo.git')).toEqual({ host: 'git.corp.example.com', owner: 'team', repo: 'repo' })
    expect(parseGithubRemote('git@git.corp.example.com:team/repo.git')).toEqual({ host: 'git.corp.example.com', owner: 'team', repo: 'repo' })
  })

  it('非 git / 不完整字符串 ⇒ null', () => {
    for (const value of ['', 'not-a-remote', 'https://github.com/o', '/local/path/repo.git', 'file:///d/repo.git']) {
      expect(parseGithubRemote(value), `${JSON.stringify(value)} 不应被认成 GitHub remote`).toBeNull()
    }
  })
})

describe('maskToken —— 日志里只出现头尾', () => {
  it('短 token 全遮', () => {
    expect(maskToken('short')).toBe('****')
    expect(maskToken('12345678')).toBe('****')
  })

  it('长 token 保留头 4 尾 4', () => {
    expect(maskToken('ghp_abcdefghijklmnop')).toBe('ghp_****mnop')
    expect(maskToken('123456789')).toBe('1234****6789')
  })
})

describe('apiBase / webReleaseUrl', () => {
  it('github.com → api.github.com（www 也算）', () => {
    expect(apiBase(REPO)).toBe('https://api.github.com')
    expect(apiBase({ ...REPO, host: 'www.github.com' })).toBe('https://api.github.com')
  })

  it('企业域名 → <host>/api/v3', () => {
    expect(apiBase({ ...REPO, host: 'git.corp.example.com' })).toBe('https://git.corp.example.com/api/v3')
  })

  it('环境变量 GITHUB_API_URL 覆盖一切（去掉结尾斜杠；空白值不算覆盖）', () => {
    process.env.GITHUB_API_URL = 'https://ghe.internal/api/v3/'
    expect(apiBase(REPO)).toBe('https://ghe.internal/api/v3')
    expect(apiBase({ ...REPO, host: 'git.corp.example.com' })).toBe('https://ghe.internal/api/v3')

    process.env.GITHUB_API_URL = '   '
    expect(apiBase(REPO)).toBe('https://api.github.com')
  })

  it('网页链接编码 tag', () => {
    expect(webReleaseUrl(REPO, 'v1.2.3')).toBe('https://github.com/o/r/releases/tag/v1.2.3')
    expect(webReleaseUrl(REPO, 'v1.2.3/weird')).toBe('https://github.com/o/r/releases/tag/v1.2.3%2Fweird')
  })
})

describe('findRelease —— 「没有 Release」与「查不到」分开', () => {
  it('http 404 ⇒ null，且不重试', async () => {
    const fetchMock = stubFetch(responseOf('{"message":"Not Found"}', 404))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('200 + 响应体是 JSON null ⇒ null', async () => {
    stubFetch(responseOf('null'))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).resolves.toBeNull()
  })

  it('200 + 空响应体 ⇒ null', async () => {
    stubFetch(responseOf(''))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).resolves.toBeNull()
  })

  it('200 + 对象但没有 id ⇒ null', async () => {
    stubFetch(responseOf(JSON.stringify({ tag_name: 'v1.2.0', name: 'x' })))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).resolves.toBeNull()
  })

  it('200 + 真 Release ⇒ 收口成 GithubRelease', async () => {
    stubFetch(responseOf(JSON.stringify({
      id: 42,
      tag_name: 'v1.2.0',
      name: 'v1.2.0',
      body: '正文',
      html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
      draft: false,
      prerelease: false,
    })))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).resolves.toEqual({
      id: 42,
      tagName: 'v1.2.0',
      name: 'v1.2.0',
      body: '正文',
      url: 'https://github.com/o/r/releases/tag/v1.2.0',
      draft: false,
      prerelease: false,
    })
  })

  it('5xx 用尽重试后抛（调用方据此把 releaseChecked 置 false）', async () => {
    const fetchMock = stubFetch(responseOf('boom', 503))
    await expect(findRelease({ token: null, repo: REPO }, 'v1.2.0')).rejects.toThrow('HTTP 503')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('token 只走 Authorization 头，绝不进 URL', async () => {
    const token = 'ghp_supersecrettokenvalue'
    const fetchMock = stubFetch(responseOf('null'))
    await findRelease({ token, repo: REPO }, 'v1.2.0')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    const url = String(call?.[0])
    const init = call?.[1]
    expect(url).toBe('https://api.github.com/repos/o/r/releases/tags/v1.2.0')
    expect(url).not.toContain(token)
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(`Bearer ${token}`)
  })

  it('没有 token 时不带 Authorization 头（公开仓匿名查询）', async () => {
    const fetchMock = stubFetch(responseOf('null'))
    await findRelease({ token: null, repo: REPO }, 'v1.2.0')
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers.Accept).toBe('application/vnd.github+json')
  })
})
