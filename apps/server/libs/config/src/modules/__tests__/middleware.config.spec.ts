import { afterEach, describe, expect, it, vi } from 'vitest'
import middlewareConfig from '../middleware.config'

/**
 * F-43（CORS 源白名单）：`middleware.config.ts` 的 `cors.allowOrigin` 此前在非 prod
 * 环境恒为 `*`，而 cors.middleware 恒开 `credentials: true` —— 两者在 CORS 规范里互斥，
 * 浏览器会拒绝带凭据的跨源响应（全站 cookie 认证下等于开发态跨源登录失效）。
 *
 * 守四件事：
 * 1) dev / stage 返回**显式白名单**（数组、含 admin dev 的 https 源、不含 `*`）；
 * 2) `APP_CORS_ALLOW_ORIGINS` 覆盖优先（含去空白 / 空串回落）；
 * 3) prod 仍是 www 单源（改造前后一致，没有把生产放开）；
 * 4) prod 也接受 env 覆盖（多域名部署场景）。
 *
 * 环境判定 isProd 是模块求值期常量；libs 内禁止动态 import，所以这里用 vi.mock 把
 * `@walnut-server/config/utils/env` 换成可按用例改写的 getter（工厂函数本身是
 * registerAs 的惰性回调，每次调用都会重新读 process.env —— override 用例因此无需换模块）。
 */

const envMock = vi.hoisted(() => ({ isProd: false }))

vi.mock('@walnut-server/config/utils/env', () => ({
  get isDev() {
    return !envMock.isProd
  },
  get isProd() {
    return envMock.isProd
  },
  isStage: false,
  WalnutAdminEnv: 'test',
}))

interface ICorsConfig {
  allowOrigin: string | string[] | boolean
  allowMethod: string[]
  allowHeader: string[]
}

function loadCorsConfig(options: { prod?: boolean, override?: string } = {}): ICorsConfig {
  envMock.isProd = options.prod ?? false

  if (options.override === undefined) {
    vi.stubEnv('APP_CORS_ALLOW_ORIGINS', '')
  }
  else {
    vi.stubEnv('APP_CORS_ALLOW_ORIGINS', options.override)
  }

  return (middlewareConfig() as { cors: ICorsConfig }).cors
}

afterEach(() => {
  vi.unstubAllEnvs()
  envMock.isProd = false
})

describe('middleware.cors.allowOrigin：显式源白名单（F-43）', () => {
  it('development → 数组白名单，且不含通配源', () => {
    const { allowOrigin } = loadCorsConfig()

    expect(Array.isArray(allowOrigin)).toBe(true)
    expect(allowOrigin).not.toBe('*')
    expect(allowOrigin).not.toContain('*')
  })

  it('development 白名单覆盖 admin dev（https 3100，mkcert 起 https）与 server / docs 端口', () => {
    const { allowOrigin } = loadCorsConfig()
    const origins = allowOrigin as string[]

    // admin dev：vite-plugin-mkcert 让 dev server 走 https；127.0.0.1 是 VITE_HOST 默认值
    expect(origins).toContain('https://127.0.0.1:3100')
    expect(origins).toContain('https://localhost:3100')
    // 后端自身（Scalar / 直连调试）与 docs dev
    expect(origins).toContain('http://127.0.0.1:3000')
    expect(origins).toContain('http://localhost:8886')
    // 双协议双 host 的稳定规模（4 端口 × 2 host × 2 协议）
    expect(origins).toHaveLength(16)
  })

  it('stage 同样走白名单（stage 不是 prod，也不是通配源）', () => {
    const { allowOrigin } = loadCorsConfig()

    expect(Array.isArray(allowOrigin)).toBe(true)
    expect(allowOrigin).not.toContain('*')
  })

  it('production → https://www.<config.domain> 单源（改造前后一致）', () => {
    const { allowOrigin } = loadCorsConfig({ prod: true })

    expect(allowOrigin).toBe('https://www.walnut-admin.com')
  })

  it('env 覆盖 APP_CORS_ALLOW_ORIGINS 优先：逗号分隔 + 去空白', () => {
    const { allowOrigin } = loadCorsConfig({
      override: ' https://a.example.com , https://b.example.com ',
    })

    expect(allowOrigin).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('env 覆盖为空串 / 全空白 → 回落到内置默认值（不是空白名单）', () => {
    expect(loadCorsConfig({ override: '' }).allowOrigin).toHaveLength(16)
    expect(loadCorsConfig({ override: ' , , ' }).allowOrigin).toHaveLength(16)
  })

  it('prod 也接受 env 覆盖（多域名部署不必改代码）', () => {
    const { allowOrigin } = loadCorsConfig({
      prod: true,
      override: 'https://www.example.com,https://admin.example.com',
    })

    expect(allowOrigin).toEqual(['https://www.example.com', 'https://admin.example.com'])
  })

  it('方法与头白名单不受影响（改造只碰 allowOrigin）', () => {
    const { allowMethod, allowHeader } = loadCorsConfig()

    expect(allowMethod).toEqual(['GET', 'POST', 'DELETE', 'PUT', 'PATCH'])
    expect(allowHeader).toContain('Authorization')
  })
})
