import { describe, expect, it } from 'vitest'

import { buildSignRaw, splitPathAndQuery, stripApiPrefix } from '../sign-raw'

/**
 * fixture 一致性测试：期望串取自上收前**两端现行实现**在同一组输入上的逐字节产出
 * （服务端 `sign.guard.ts` 旧 `buildSignRaw` / 管理端 `app-security.ts` 旧 `buildSignRaw`
 * 在 7 组 fixture 上输出完全一致）。
 */
describe('buildSignRaw 拼接规则', () => {
  const timestamp = 1767225600123
  const nonce = '0123456789abcdef0123456789abcdef'

  it('无 query / 无 body：空段保留', () => {
    expect(buildSignRaw({
      method: 'GET',
      path: '/system/user/me',
      timestamp,
      nonce,
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    })).toBe('GET|/system/user/me||timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
  })

  it('中文/空格/加号/&/问号 query 按已序列化原文拼接', () => {
    expect(buildSignRaw({
      method: 'GET',
      path: '/system/log',
      query: 'page=1&pageSize=10&keyword=%E4%B8%AD%E6%96%87%20%E5%80%BC%2B%26%3F%3D&tags=a%2Cb',
      timestamp,
      nonce,
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })).toBe('GET|/system/log?page=1&pageSize=10&keyword=%E4%B8%AD%E6%96%87%20%E5%80%BC%2B%26%3F%3D&tags=a%2Cb||timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')
  })

  it('空串/false/0 的 query 值保留', () => {
    expect(buildSignRaw({
      method: 'GET',
      path: '/system/locale',
      query: 'keyword=&sort=&flag=false&zero=0',
      timestamp,
      nonce,
      ua: 'ua',
    })).toBe('GET|/system/locale?keyword=&sort=&flag=false&zero=0||timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=ua')
  })

  it('嵌套 body 扁平化后按 key 排序（含数组下标、null、中文值）', () => {
    expect(buildSignRaw({
      method: 'POST',
      path: '/system/menu',
      body: {
        name: '菜单',
        parentId: null,
        meta: { title: '标题', icon: 'i-carbon-home', order: 1, hidden: false },
        route: [1, 2, { a: 'b', c: [true, null] }],
        empty: {},
        emptyList: [],
      },
      timestamp,
      nonce,
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    })).toBe('POST|/system/menu|meta.hidden=false&meta.icon=i-carbon-home&meta.order=1&meta.title=标题&name=菜单&parentId=null&route[0]=1&route[1]=2&route[2].a=b&route[2].c[0]=true&route[2].c[1]=null|timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0')
  })

  it('ua 与 body 含竖线和中文等特殊字符时不做转义', () => {
    expect(buildSignRaw({
      method: 'DELETE',
      path: '/system/user/1',
      query: 'reason=a%7Cb%7Cc&k%20e%20y=v%26v%3Dv',
      body: { note: '含|竖线|和中文' },
      timestamp,
      nonce,
      ua: 'Custom-UA/1.0 中文 | with pipes & <xml> = chars (test)',
    })).toBe('DELETE|/system/user/1?reason=a%7Cb%7Cc&k%20e%20y=v%26v%3Dv|note=含|竖线|和中文|timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=Custom-UA/1.0 中文 | with pipes & <xml> = chars (test)')
  })

  it('根数组 body', () => {
    expect(buildSignRaw({
      method: 'PUT',
      path: '/system/user/batch',
      query: 'force=true',
      body: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      timestamp,
      nonce,
      ua: 'ua',
    })).toBe('PUT|/system/user/batch?force=true|[0].id=1&[0].name=a&[1].id=2&[1].name=b|timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=ua')
  })

  it('空 path 回落 `/`；显式空 query 保留尾随问号（验证端 req.url 语义）', () => {
    expect(buildSignRaw({ method: 'GET', path: '', timestamp, nonce, ua: 'ua' }))
      .toBe('GET|/||timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=ua')
    expect(buildSignRaw({ method: 'GET', path: '', query: '', timestamp, nonce, ua: 'ua' }))
      .toBe('GET|/?||timestamp=1767225600123|nonce=0123456789abcdef0123456789abcdef|ua=ua')
  })
})

describe('路径预处理', () => {
  it('splitPathAndQuery 保留 query 原文（无解码/重编码）', () => {
    expect(splitPathAndQuery('/system/log?page=1&keyword=%E4%B8%AD')).toEqual({
      path: '/system/log',
      query: 'page=1&keyword=%E4%B8%AD',
    })
    expect(splitPathAndQuery('/system/user/me')).toEqual({ path: '/system/user/me' })
    expect(splitPathAndQuery('/system/log?')).toEqual({ path: '/system/log', query: '' })
  })

  it('stripApiPrefix 与服务端旧正则同口径', () => {
    expect(stripApiPrefix('/w/v1/system/user/me', 'w', 1)).toBe('/system/user/me')
    expect(stripApiPrefix('/w/v1', 'w', 1)).toBe('/')
    expect(stripApiPrefix('/other/path', 'w', 1)).toBe('/other/path')
  })
})
