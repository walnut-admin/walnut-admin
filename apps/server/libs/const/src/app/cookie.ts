import type { ValueOf } from 'easy-fns-ts'
import { isDev, isProd } from '@walnut-server/config/utils/env'

function getSafeCookieKey(baseKey: string): string {
  if (isProd) {
    // Production: HTTPS + domain
    // 必须用 __Secure- (因为有 domain 设置)
    return `__Secure-${baseKey}`
  }

  if (isDev) {
    // Dev: 前端 HTTPS localhost
    // 可以使用 __Host- (localhost 被视为安全上下文)
    return `__Host-${baseKey}`
  }

  // Stage: HTTP + IP (即使有 browser flag)
  // 不使用前缀
  return baseKey
}
export const WalnutAdminConstCookieKeys = {
  DEVICE_ID: getSafeCookieKey('DEVICE_ID'),
  CAPJS_TOKEN: getSafeCookieKey('CAPJS_TOKEN'),
  RT_JTI: getSafeCookieKey('RT_JTI'),
  SIGN_TICKET: getSafeCookieKey('SIGN_TICKET'),
} as const

export type IWalnutAdminConstCookieKeys = ValueOf<typeof WalnutAdminConstCookieKeys>
