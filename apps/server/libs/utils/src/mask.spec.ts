import { describe, expect, it } from 'vitest'

import { maskIdentityValue } from './mask'

// libs 解耦批 6 随身份内核下沉的纯函数（原 SharedMaskService.maskIdentityValue）。
// 钉四类掩码格式 + 未知类型透传；手机号的「带/不带国家码」两条腿都要钉。

describe('maskIdentityValue', () => {
  it('phoneNumber：带国家码（+ 前缀，尾 11 位为主号）', () => {
    expect(maskIdentityValue('phoneNumber', '+8613812345678')).toBe('+86138****5678')
  })

  it('phoneNumber：不带国家码', () => {
    expect(maskIdentityValue('phoneNumber', '13812345678')).toBe('138****5678')
  })

  it('emailAddress：local 段首尾保留、中间全掩', () => {
    expect(maskIdentityValue('emailAddress', 'zhangsan@example.com')).toBe('z******n@example.com')
  })

  it('emailAddress：local 段 ≤2 时只留一个 *', () => {
    expect(maskIdentityValue('emailAddress', 'ab@example.com')).toBe('*@example.com')
  })

  it('idCard：18 位保留前 6 后 4', () => {
    expect(maskIdentityValue('idCard', '110101199001011234')).toBe('110101********1234')
  })

  it('idCard：非 18 位保留前 4 后 4', () => {
    expect(maskIdentityValue('idCard', '11010119900101')).toBe('1101****0101')
  })

  it('password：恒定 8 个 *', () => {
    expect(maskIdentityValue('password', 'whatever')).toBe('********')
  })

  it('未知类型原样透传', () => {
    expect(maskIdentityValue('nickname', 'walnut')).toBe('walnut')
  })
})
