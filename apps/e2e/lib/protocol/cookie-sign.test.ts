/**
 * `signCookieValue` 的固定向量：算法抄错（换 sha1 / 保留 base64 填充 / 漏掉 `s:`）都必须红。
 *
 * 期望值由 `cookie-signature@1.0.6` 的公式独立算出后固定在测试里；密钥与值都是
 * 明显的假样本（不触发 check-source-secrets：不是凭据形状）。
 */
import { describe, expect, it } from 'vitest'
import { signCookieValue } from './cookie-sign.ts'

describe('signCookieValue', () => {
  it('按 cookie-signature@1.0.6 的格式签名（s: + value + . + 无填充 base64 HMAC-SHA256）', () => {
    expect(signCookieValue('not-a-cap-token', 'e2e-cookie-secret'))
      .toBe('s:not-a-cap-token.3RiDUIUie6c7tOSU5SJqDm2Y1oVCbFuGWIFc9Dch4/o')
  })

  it('签名是确定性的，且同一值换密钥即不同', () => {
    const value = 'hex:hex'
    expect(signCookieValue(value, 'secret-a')).toBe(signCookieValue(value, 'secret-a'))
    expect(signCookieValue(value, 'secret-a')).not.toBe(signCookieValue(value, 'secret-b'))
  })
})
