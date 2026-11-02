import type { ValueOf } from 'easy-fns-ts'
import { WalnutAdminConstCookieKeys as _CookieBaseKeys } from '@walnut/contract/cookie'
import { isDev, isProd } from './env'

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

// ─── DEVICE_ID cookie 寿命与滑动续期（P0-1）─────────────────────────────────
//
// P0-1 死锁：cookie 原先 30 天**硬过期无续期**，而前端 setupDeviceId 只看
// localStorage（有值就不调 /system/device/initial）⇒ 第 31 天起全站 40605，连登录
// 端点都在 DeviceGuard 之后，用户连重新登录都做不到。
//
// 后端这一半是**滑动续期**：DeviceGuard 每次校验命中后，用一个 Redis 时间闸
// （SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>，TTL = 续期间隔）判断「距上次续期是否已超过
// 间隔」，超过就重发 cookie（maxAge 重新拉满）。间隔取有效期的 80%，于是 cookie 的
// 剩余寿命恒 > 20%，永远走不到 0。
//
// 两个值同源在一个文件：改 maxAge 时续期间隔自动跟着变（临时把 maxAge 调成 5 秒做
// 验收时，续期间隔自动变 4 秒，滑动续期才真的能观察到）。
export const WalnutAdminConstDeviceCookieMaxAge = 30 * 24 * 60 * 60 * 1000

/** 续期间隔 = 有效期的 80%（24 天）：一旦超过就重发，剩余寿命恒 > 20% */
export const WalnutAdminConstDeviceCookieRenewInterval = Math.floor(WalnutAdminConstDeviceCookieMaxAge * 0.8)
