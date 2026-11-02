import type { NextFunction } from 'express'
import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CorsMiddleware } from './cors.middleware'

/**
 * F-43（cors.middleware 侧）：`credentials: true` 是本项目 cookie 认证的硬需求，
 * 因此 allowOrigin 必须是**具体源**（通配源 + 凭据在浏览器侧必然被拒）。本文件用
 * 真 cors 中间件 + 最小 req/res 桩验证三件事：
 * 1) 白名单内的 Origin 被原样回写，且同时带 Access-Control-Allow-Credentials: true；
 * 2) 白名单外的 Origin **不**回写 ACAO（浏览器据此拒绝）；
 * 3) 一旦哪天 env 把 allowOrigin 改回通配，构造期 warn 一次（不静默）。
 */

const ALLOW_ORIGIN = ['https://127.0.0.1:3100', 'http://localhost:3000']

function createMiddleware(config: Record<string, unknown>) {
  return new CorsMiddleware({ get: (key: string) => config[key] } as never)
}

function invoke(middleware: CorsMiddleware, origin?: string) {
  const headers: Record<string, string | number | undefined> = {}
  const res = {
    statusCode: 200,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value
    },
    getHeader: (key: string) => headers[key.toLowerCase()],
    end: vi.fn(),
  }
  const req = { method: 'GET', headers: origin === undefined ? {} : { origin } }
  const next = vi.fn() as unknown as NextFunction

  middleware.use(req as never, res as never, next)

  return { headers, next, res }
}

function baseConfig(allowOrigin: unknown) {
  return {
    'middleware.cors.allowOrigin': allowOrigin,
    'middleware.cors.allowMethod': ['GET', 'POST'],
    'middleware.cors.allowHeader': ['Authorization', 'Content-Type'],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('corsMiddleware：显式源 + credentials: true（F-43）', () => {
  it('白名单内的 Origin → 原样回写 ACAO，并带 Allow-Credentials: true', () => {
    const middleware = createMiddleware(baseConfig(ALLOW_ORIGIN))
    const { headers, next } = invoke(middleware, 'https://127.0.0.1:3100')

    expect(headers['access-control-allow-origin']).toBe('https://127.0.0.1:3100')
    expect(headers['access-control-allow-credentials']).toBe('true')
    expect(next).toHaveBeenCalledOnce()
  })

  it('白名单外的 Origin → 不回写 ACAO（只有 Vary），仍放行到下游（由浏览器拦响应）', () => {
    const middleware = createMiddleware(baseConfig(ALLOW_ORIGIN))
    const { headers, next } = invoke(middleware, 'https://evil.example.com')

    expect(headers['access-control-allow-origin']).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('无 Origin 头（同源 / 服务端直连）→ 不写 ACAO，也不报错', () => {
    const middleware = createMiddleware(baseConfig(ALLOW_ORIGIN))
    const { headers, next } = invoke(middleware)

    expect(headers['access-control-allow-origin']).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('prod 单源字符串配置同样生效（回写该源 + credentials）', () => {
    const middleware = createMiddleware(baseConfig('https://www.walnut-admin.com'))
    const { headers } = invoke(middleware, 'https://www.walnut-admin.com')

    expect(headers['access-control-allow-origin']).toBe('https://www.walnut-admin.com')
    expect(headers['access-control-allow-credentials']).toBe('true')
  })

  it('通配源 `*` → 构造期 warn 一次（通配 + 凭据在浏览器侧必然失败，不能静默）', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    createMiddleware(baseConfig('*'))

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('credentials')
  })

  it('数组里混入 `*` 同样告警（白名单写法不是免死金牌）', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    createMiddleware(baseConfig(['*', ...ALLOW_ORIGIN]))

    expect(warn).toHaveBeenCalledOnce()
  })

  it('显式白名单不产生告警（正常路径没有噪声）', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    createMiddleware(baseConfig(ALLOW_ORIGIN))

    expect(warn).not.toHaveBeenCalled()
  })
})
