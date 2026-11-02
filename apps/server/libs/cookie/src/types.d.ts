import type { IWalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import type { CookieOptions } from 'express'

declare global {
  interface IWalnutAdminCookieOptions {
    key: IWalnutAdminConstCookieKeys
    value: string
    options?: CookieOptions
  }
}

export {}
