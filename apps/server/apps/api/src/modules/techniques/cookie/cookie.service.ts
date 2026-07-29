import { Injectable, Logger } from '@nestjs/common'
import { isDev, isProd } from '@walnut-server/config/utils/env'
import { getPackageJsonData } from '@walnut-server/utils/pkg'
import { Recordable } from 'easy-fns-ts'
import type { CookieOptions } from 'express'

// Note: IWalnutAdminCookieOptions interface has been moved to @walnut-server/types/walnut-admin/cookie.d.ts
// as IWalnutAdminCookieOptions

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
    return {
      httpOnly: true,
      secure: false,
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
