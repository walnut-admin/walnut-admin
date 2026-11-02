import type { CookieOptions } from 'express'
import { Injectable, Logger } from '@nestjs/common'
import { isDev, isProd } from '@walnut-server/config/utils/env'
import { getPackageJsonData } from '@walnut-server/utils/pkg'
import { Recordable } from 'easy-fns-ts'

// Note: IWalnutAdminCookieOptions interface is declared ambient (declare global) in
// this lib's types.d.ts

const pkg = getPackageJsonData()

export function defaultCookieOptions(signed = true): CookieOptions {
  if (isDev) {
    // dev
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      signed,
    }
  }

  // prod
  if (isProd) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      signed,
      // need domain here for production purpose
      // otherwise cookie would not exist as expected when oauth callback
      domain: `.${(pkg.config as Recordable).domain as string}`,
    }
  }
  else {
    // stage
    //
    // F-43（2026-11，安全纵深）：secure 从 false 收紧为 true。
    //
    // 依据：本仓库**没有**独立的 stage 部署入口 —— 唯一的部署面是 deploy/ 的 nginx
    // （deploy/nginx/conf.d/*.conf），两个 server 都是 `listen 443 ssl`，80 端口只有
    // 一条 301 跳 https；stage 只是构建/启动形态（NODE_ENV=stage + dist-stage，
    // 见 apps/server/package.json 的 build:stage / start:stage），产物预期跑在同一条
    // TLS 边缘后面。`secure: false` 的唯一「好处」是「明文 HTTP 也能用」，代价是：
    // 一旦 stage 域名真的可被 http 访问，DEVICE_ID / SIGN_TICKET / CAPJS_TOKEN 这些
    // 认证凭据就会跟着明文请求一起发出去（浏览器对 secure:false 的 cookie 不做限制）。
    //
    // 若某个 stage 环境确实只能跑纯 HTTP，请显式改这一行而不是放宽全局默认 ——
    // 那种环境本来就不该承载带凭据的登录流程。
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      signed,
    }
  }
}

/**
 * A simplified cookie service for setting and clearing response cookies.
 * Designed to be used in controllers with explicit response object passing.
 */
@Injectable()
export class AppTechCookieService {
  constructor() {}

  private readonly logger = new Logger(AppTechCookieService.name)

  /**
   * @description set cookie with encrypt support
   */
  setResponseCookie(req: IWalnutAdminExpressRequest, cookies: IWalnutAdminCookieOptions[]): void {
    cookies.forEach((cookie) => {
      if (!cookie.key || cookie.value === undefined) {
        this.logger.error('Cookie configuration missing name or value')
        return
      }

      req.res?.cookie(cookie.key, cookie.value, {
        ...defaultCookieOptions(),
        ...cookie.options || {},
      })
    })
  }

  /**
   * @description Clear specified cookies by setting their expiration to the past.
   */
  clearCookie(req: IWalnutAdminExpressRequest, cookies: Partial<IWalnutAdminCookieOptions>[]): void {
    cookies.forEach((item) => {
      req.res?.cookie(item.key!, '', {
        ...defaultCookieOptions(),
        ...item.options,
        expires: new Date(0),
      })
    })
  }
}
