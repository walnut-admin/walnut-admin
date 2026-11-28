import type { IWalnutAdminCookieEnv } from '../cookie.service'
import { describe, expect, it } from 'vitest'
import { defaultCookieOptions } from '../cookie.service'

/**
 * F-43（cookie 默认选项）：`stage` 分支的 `secure` 此前是 false —— 而本仓库没有独立的
 * stage 部署入口，唯一的部署面（deploy/nginx/conf.d/*.conf）两个 server 都是
 * `listen 443 ssl`、80 只有一条 301 跳 https。`secure: false` 意味着 DEVICE_ID /
 * SIGN_TICKET / CAPJS_TOKEN 这些认证 cookie 一旦被明文 HTTP 请求带上就会裸奔。
 *
 * 这里钉住三个环境的**完整**默认值（不只 secure），因为 cookie 的 httpOnly / sameSite /
 * domain 同样是安全属性，改动时不该有任何一项悄悄漂移。
 *
 * 环境判定是显式注入的第二个参数（2026-11）：原先用 `vi.mock('@walnut-server/config/utils/env')`
 * 改写模块级 getter，但 vitest `isolate: false` 下模块图跨文件共享 —— 该 mock 既可能被前一个
 * 文件的真实求值顶掉（本文件的断言读到真实 env），也可能反过来泄漏给后续文件。改成参数注入后，
 * 每条用例声明自己要的环境，不再依赖 worker 里的求值顺序。
 */

function envOf(name: 'development' | 'stage' | 'production'): IWalnutAdminCookieEnv {
  return {
    isDev: name === 'development',
    isProd: name === 'production',
  }
}

function loadCookieOptions(env: 'development' | 'stage' | 'production', signed = true) {
  return defaultCookieOptions(signed, envOf(env))
}

describe('defaultCookieOptions：三环境默认值（F-43 stage secure）', () => {
  it('development → httpOnly + secure + sameSite=lax，无 domain', () => {
    const options = loadCookieOptions('development')

    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      signed: true,
    })
  })

  it('stage → secure 必须是 true（F-43：stage 产物跑在 TLS 边缘后面）', () => {
    const options = loadCookieOptions('stage')

    expect(options.secure).toBe(true)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    // stage 不设 domain：与 prod 的 .walnut-admin.com 区分（stage 域名不固定，
    // 套用生产 domain 会让 cookie 在 stage 域上被浏览器丢弃）
    expect(options.domain).toBeUndefined()
  })

  it('production → secure + sameSite=none + 生产 domain（oauth 回跳需要）', () => {
    const options = loadCookieOptions('production')

    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      signed: true,
      domain: '.walnut-admin.com',
    })
  })

  it('signed=false 原样透传（三个环境都遵守调用方意图）', () => {
    for (const env of ['development', 'stage', 'production'] as const) {
      const options = loadCookieOptions(env, false)
      expect(options.signed, env).toBe(false)
    }
  })

  it('三个环境一律 secure + httpOnly（不允许任何分支退化为明文 / JS 可读）', () => {
    for (const env of ['development', 'stage', 'production'] as const) {
      const options = loadCookieOptions(env)
      expect(options.secure, env).toBe(true)
      expect(options.httpOnly, env).toBe(true)
    }
  })
})
