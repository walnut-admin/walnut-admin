import type { ValueOf } from 'easy-fns-ts'
import { isDev, isProd } from '@walnut-server/config/utils/env'
import { WalnutAdminConstCookieKeys as _CookieBaseKeys } from '@walnut/contract/cookie'

function getSafeCookieKey(baseKey: string): string {
  if (isProd) {
    return `__Secure-${baseKey}`
  }

  if (isDev) {
    return `__Host-${baseKey}`
  }

  return baseKey
}

export const WalnutAdminConstCookieKeys = {
  DEVICE_ID: getSafeCookieKey(_CookieBaseKeys.DEVICE_ID),
  CAPJS_TOKEN: getSafeCookieKey(_CookieBaseKeys.CAPJS_TOKEN),
  RT_JTI: getSafeCookieKey(_CookieBaseKeys.RT_JTI),
  SIGN_TICKET: getSafeCookieKey(_CookieBaseKeys.SIGN_TICKET),
} as const

export type IWalnutAdminConstCookieKeys = ValueOf<typeof WalnutAdminConstCookieKeys>
