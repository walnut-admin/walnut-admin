import { describe, expect, it } from 'vitest'
import { generateDeviceId, isValidDeviceId, WALNUT_DEVICE_ID_PREFIX } from './device-id'

describe('device id：服务端签发与形态校验（B5）', () => {
  it('签发出的 id 必须是 d1_ 前缀 + 32 位小写 hex', () => {
    const id = generateDeviceId()
    expect(id.startsWith(WALNUT_DEVICE_ID_PREFIX)).toBe(true)
    expect(id).toMatch(/^d1_[0-9a-f]{32}$/)
    expect(isValidDeviceId(id)).toBe(true)
  })

  it('连续两次签发必须不同（身份不再由指纹派生）', () => {
    const set = new Set(Array.from({ length: 64 }, () => generateDeviceId()))
    expect(set.size).toBe(64)
  })

  it('旧形态（64 位 hex）必须被判为非法 —— 这是「硬切」的判据', () => {
    // 改造前的真实形态：对指纹做 HMAC 得到的 64 位 hex
    expect(isValidDeviceId('5fbd10a430391c1438ef8aa0'.padEnd(64, '0'))).toBe(false)
    expect(isValidDeviceId('a'.repeat(64))).toBe(false)
  })

  it('伪造与畸形值必须被判为非法', () => {
    for (const bad of ['', 'd1_', 'd1_xyz', `D1_${'a'.repeat(32)}`, `d1_${'A'.repeat(32)}`, ` d1_${'a'.repeat(32)}`, `d1_${'a'.repeat(31)}`, `d1_${'a'.repeat(33)}`]) {
      expect(isValidDeviceId(bad), `应判非法: ${JSON.stringify(bad)}`).toBe(false)
    }
  })

  it('非字符串一律判非法（cookie-parser 对坏签名会返回 false）', () => {
    for (const bad of [undefined, null, false, 0, {}, []]) {
      expect(isValidDeviceId(bad)).toBe(false)
    }
  })
})
