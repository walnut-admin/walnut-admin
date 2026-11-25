/**
 * Express `res.cookie(..., { signed: true })` 的签名算法（`cookie-signature@1.0.6`）：
 * `'s:' + value + '.' + base64(HMAC-SHA256(value, secret))`（去掉 base64 的 `=` 填充）。
 *
 * 为什么 E2E 需要它：CAP guard 的 40111（`UNAUTHORIZED_BOT_VERIFY_FAILED`）只在
 * 「**签名合法**、但值不是 cap.js token 形态」时抛出；客户端自己塞一个未签名的
 * `CAPJS_TOKEN` 会被 `cookie-parser` 当成缺失（signedCookies 里没有它）→ 40116，
 * 根本走不到 40111。也就是说这条分支只能由「持有 cookie secret 的一方」构造出来
 * （服务端签发的值永远是 `hex:hex`）。
 *
 * 用途严格限定在 U13 的 40111 分支：secret 从 `apps/server/env-local/.env.stage`
 * 的 `APP_COOKIE_SECRET` 运行时读取，**不写进任何文件 / 附件**；签出来的值只是一枚
 * 畸形 cookie，不含任何真实凭据。
 *
 * 算法与 `cookie-signature` 的同源证据：该包 1.0.6 的 `sign()` 就是
 * `crypto.createHmac('sha256', secret).update(val).digest('base64').replace(/=+$/, '')`。
 */
import { createHmac } from 'node:crypto'

/** 签名一枚 cookie 值（返回未 URL 编码的 `s:<value>.<sig>`） */
export function signCookieValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64').replace(/=+$/, '')
  return `s:${value}.${signature}`
}
