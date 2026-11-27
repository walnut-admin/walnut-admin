/**
 * `docs:version` 的判定与写入：HTTP 结果 → 版本号，以及写盘的格式。
 *
 * 网络用 `vi.stubGlobal('fetch', …)` 注入（与 release 的 `github.test.ts` 同一写法），
 * 文件写进临时目录 —— 用例**永不碰**真实的 `apps/docs/version.json`。
 * 重点不是「跑得通」，而是几条静默失效面：404 回退是否真的走了本机 tag、`tag_name` 为空
 * 会不会被当成有效版本、token 有没有漏进 URL、错误体有没有整页打进日志。
 */

import type { ReleaseLookup } from '../docs-version.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreconditionError } from '../../lib/errors.ts'
import {
  decideVersion,
  latestTagFromBody,
  localLatestTag,
  resolveRepo,
  runDocsVersion,
} from '../docs-version.ts'

const originalApiUrl = process.env.GITHUB_API_URL

let tempDir: string = ''
let versionFile: string = ''

interface StubResponse {
  status: number
  text: () => Promise<string>
}

function responseOf(body: string, status = 200): StubResponse {
  return { status, text: async () => body }
}

/** 装上 fetch 桩并返回它（调用参数供检查 URL / 请求头） */
function stubFetch(response: StubResponse) {
  const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 默认输入：能解析的 remote、两个本机 tag、无 token、临时目录里的目标文件 */
function inputWith(overrides: Partial<Parameters<typeof runDocsVersion>[0]> = {}) {
  return {
    remoteUrl: 'git@github.com:o/r.git',
    localTags: ['v2.0.0', 'v1.0.0'],
    token: null,
    versionFile,
    ...overrides,
  }
}

beforeEach(() => {
  delete process.env.GITHUB_API_URL
  tempDir = mkdtempSync(join(tmpdir(), 'walnut-docs-version-'))
  versionFile = join(tempDir, 'version.json')
})

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.GITHUB_API_URL
  else process.env.GITHUB_API_URL = originalApiUrl
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('latestTagFromBody —— 只认非空的 tag_name 字符串', () => {
  it('正常响应体取 tag_name（首尾空白去掉，不动 v 前缀）', () => {
    expect(latestTagFromBody(JSON.stringify({ tag_name: 'v1.2.3', name: 'x' }))).toBe('v1.2.3')
    expect(latestTagFromBody(JSON.stringify({ tag_name: '  v1.2.3  ' }))).toBe('v1.2.3')
  })

  it('空字符串 / 只有空白 / 字段缺失 / 非字符串 / 不是对象 ⇒ null', () => {
    for (const body of [
      JSON.stringify({ tag_name: '' }),
      JSON.stringify({ tag_name: '   ' }),
      JSON.stringify({ name: 'v1.2.3' }),
      JSON.stringify({ tag_name: 123 }),
      JSON.stringify(null),
      JSON.stringify([]),
    ])
      expect(latestTagFromBody(body), `${body} 不应被认成有效版本`).toBeNull()
  })

  it('响应体不是 JSON ⇒ null', () => {
    expect(latestTagFromBody('<html>not json</html>')).toBeNull()
  })
})

describe('localLatestTag / resolveRepo', () => {
  it('本机 tag 取第一个非空项（顺序由 git 的 -v:refname 给定）', () => {
    expect(localLatestTag(['v0.2.0', 'v0.1.0'])).toBe('v0.2.0')
    expect(localLatestTag(['', '  v0.2.0  ', 'v0.1.0'])).toBe('v0.2.0')
  })

  it('本机没有 tag ⇒ 前置条件错误（消息说明两条出路）', () => {
    expect(() => localLatestTag([])).toThrow(PreconditionError)
    expect(() => localLatestTag(['', '  '])).toThrow(/没有.*tag/)
  })

  it('remote 读不到 / 解析不出 ⇒ 前置条件错误，消息带支持的形态', () => {
    expect(() => resolveRepo(null)).toThrow(PreconditionError)
    expect(() => resolveRepo('file:///d/repo.git')).toThrow(/支持的形态/)
  })
})

describe('decideVersion —— 状态码 → 取哪个版本或抛什么', () => {
  it('200 + 有效 tag_name ⇒ 用它，来源 GitHub Release', () => {
    const lookup: ReleaseLookup = {
      ok: true,
      status: 200,
      body: JSON.stringify({ tag_name: 'v0.1.24' }),
    }
    expect(decideVersion(lookup, ['v9.9.9'])).toEqual({ version: 'v0.1.24', source: 'release' })
  })

  it('404 ⇒ 回退本机最新 tag，来源 local-tag', () => {
    const lookup: ReleaseLookup = { ok: true, status: 404, body: '{"message":"Not Found"}' }
    expect(decideVersion(lookup, ['v0.2.0', 'v0.1.0'])).toEqual({
      version: 'v0.2.0',
      source: 'local-tag',
    })
  })

  it('404 且本机没有 tag ⇒ 前置条件错误', () => {
    const lookup: ReleaseLookup = { ok: true, status: 404, body: '{"message":"Not Found"}' }
    expect(() => decideVersion(lookup, [])).toThrow(PreconditionError)
  })

  it('200 但 tag_name 为空 / 响应体不是 JSON ⇒ 前置条件错误（不能写成空版本）', () => {
    expect(() =>
      decideVersion({ ok: true, status: 200, body: '{"tag_name":""}' }, ['v1.0.0']),
    ).toThrow(/tag_name/)
    expect(() =>
      decideVersion({ ok: true, status: 200, body: '<html>oops</html>' }, ['v1.0.0']),
    ).toThrow(/tag_name/)
  })

  it('其它非 200 ⇒ 前置条件错误，消息带状态码', () => {
    expect(() => decideVersion({ ok: true, status: 500, body: 'boom' }, [])).toThrow(/HTTP 500/)
    expect(() => decideVersion({ ok: true, status: 403, body: 'rate limited' }, [])).toThrow(
      /HTTP 403/,
    )
  })

  it('网络错误 / 超时 ⇒ 前置条件错误（不是「没有 Release」）', () => {
    expect(() => decideVersion({ ok: false, reason: 'fetch failed' }, ['v1.0.0'])).toThrow(
      /网络错误或超时/,
    )
  })
})

describe('runDocsVersion —— 网络 + 文件写入', () => {
  it('200 ⇒ 写 { version } 且格式是两空格缩进 + 结尾换行；返回旧值 → 新值', async () => {
    writeFileSync(versionFile, '{"version":"v1.10.0"}', 'utf8')
    stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))

    const result = await runDocsVersion(inputWith())
    expect(result).toEqual({
      previous: 'v1.10.0',
      version: 'v0.1.24',
      source: 'release',
      file: versionFile,
    })
    expect(readFileSync(versionFile, 'utf8')).toBe('{\n  "version": "v0.1.24"\n}\n')
  })

  it('文件不存在时 previous 为 null，照样写出', async () => {
    stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))
    const result = await runDocsVersion(inputWith())
    expect(result.previous).toBeNull()
    expect(readFileSync(versionFile, 'utf8')).toBe('{\n  "version": "v0.1.24"\n}\n')
  })

  it('404 ⇒ 用本机最新 tag 写入（不碰网络之外的东西）', async () => {
    const fetchMock = stubFetch(responseOf('{"message":"Not Found"}', 404))
    const result = await runDocsVersion(inputWith())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('local-tag')
    expect(result.version).toBe('v2.0.0')
    expect(readFileSync(versionFile, 'utf8')).toBe('{\n  "version": "v2.0.0"\n}\n')
  })

  it('404 且本机没有 tag ⇒ 前置条件错误且**不写文件**', async () => {
    stubFetch(responseOf('{"message":"Not Found"}', 404))
    await expect(runDocsVersion(inputWith({ localTags: [] }))).rejects.toThrow(PreconditionError)
    expect(() => readFileSync(versionFile, 'utf8')).toThrow()
  })

  it('500 ⇒ 前置条件错误，响应体截断到 300 字以内（不把整页 HTML 打进日志）', async () => {
    const body = 'A'.repeat(1000)
    stubFetch(responseOf(body, 500))
    const error = await runDocsVersion(inputWith()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PreconditionError)
    const message = (error as Error).message
    expect(message).toContain('HTTP 500')
    expect(message).toContain('A'.repeat(300))
    expect(message).not.toContain('A'.repeat(301))
  })

  it('网络异常 / 超时 ⇒ 前置条件错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(runDocsVersion(inputWith())).rejects.toThrow(/网络错误或超时/)
  })

  it('200 但响应体不是 JSON ⇒ 前置条件错误', async () => {
    stubFetch(responseOf('<html>not json</html>'))
    await expect(runDocsVersion(inputWith())).rejects.toThrow(/tag_name/)
  })

  it('token 只出现在 Authorization 头，绝不进 URL', async () => {
    const token = 'ghp_supersecrettokenvalue'
    const fetchMock = stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))
    await runDocsVersion(inputWith({ token }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    const url = String(call?.[0])
    const init = call?.[1]
    expect(url).toBe('https://api.github.com/repos/o/r/releases/latest')
    expect(url).not.toContain(token)
    expect(init?.method).toBe('GET')
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${token}`)
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(headers['User-Agent']).toBeTruthy()
  })

  it('没有 token 时不带 Authorization 头', async () => {
    const fetchMock = stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))
    await runDocsVersion(inputWith({ token: null }))
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('环境变量 GITHUB_API_URL 覆盖 API 地址（企业实例）', async () => {
    process.env.GITHUB_API_URL = 'https://ghe.internal/api/v3/'
    const fetchMock = stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))
    await runDocsVersion(inputWith())
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://ghe.internal/api/v3/repos/o/r/releases/latest',
    )
  })

  it('remote 解析不出 ⇒ 前置条件错误，且一个请求都不发', async () => {
    const fetchMock = stubFetch(responseOf(JSON.stringify({ tag_name: 'v0.1.24' })))
    await expect(runDocsVersion(inputWith({ remoteUrl: 'file:///d/repo.git' }))).rejects.toThrow(
      PreconditionError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
