/**
 * GitHub 纯判定面：remote 解析、token 掩码、API base、网页链接、凭据读取口径。
 *
 * 这些函数此前住在 `@walnut/release` 的 `github.ts` 里，随 `docs:version` 的出现下沉到本包
 * （两个消费者共用一份正则与掩码）。Release 查询（`findRelease`）的用例留在原处。
 */

import type { GithubRepo } from '../github.ts'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiBase, maskToken, parseGithubRemote, tokenFromEnv, webReleaseUrl } from '../github.ts'

const originalApiUrl = process.env.GITHUB_API_URL

const REPO: GithubRepo = { host: 'github.com', owner: 'o', repo: 'r' }

beforeEach(() => {
  delete process.env.GITHUB_API_URL
})

afterEach(() => {
  if (originalApiUrl === undefined)
    delete process.env.GITHUB_API_URL
  else
    process.env.GITHUB_API_URL = originalApiUrl
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

describe('tokenFromEnv —— `GITHUB_TOKEN` > `GH_TOKEN` > 无', () => {
  it('环境变量里 GITHUB_TOKEN 优先，source 记作它', () => {
    expect(tokenFromEnv({ GITHUB_TOKEN: 'ghp_primary', GH_TOKEN: 'ghp_fallback' }))
      .toEqual({ token: 'ghp_primary', source: 'GITHUB_TOKEN' })
  })

  it('没有 GITHUB_TOKEN 时回退到 GH_TOKEN（gh CLI 的惯例名）', () => {
    expect(tokenFromEnv({ GH_TOKEN: 'ghp_fallback' })).toEqual({ token: 'ghp_fallback', source: 'GH_TOKEN' })
  })

  it('首尾空白被 trim；只有空白等于没给（不会退化成「带空值的 Bearer」）', () => {
    expect(tokenFromEnv({ GITHUB_TOKEN: '  ghp_padded  ' })).toEqual({ token: 'ghp_padded', source: 'GITHUB_TOKEN' })
    expect(tokenFromEnv({ GITHUB_TOKEN: '   ', GH_TOKEN: 'ghp_fallback' }))
      .toEqual({ token: 'ghp_fallback', source: 'GH_TOKEN' })
    expect(tokenFromEnv({ GITHUB_TOKEN: '   ', GH_TOKEN: '\t' })).toEqual({ token: null, source: null })
  })

  it('都没有 ⇒ { token: null, source: null }（不是错误，公开仓匿名可用）', () => {
    expect(tokenFromEnv({})).toEqual({ token: null, source: null })
  })

  it('只读传入的 env，不碰 process.env', () => {
    const before = process.env.GITHUB_TOKEN
    expect(tokenFromEnv({ GITHUB_TOKEN: 'ghp_injected' }).token).toBe('ghp_injected')
    expect(process.env.GITHUB_TOKEN).toBe(before)
  })
})
