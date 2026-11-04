import { describe, expect, it } from 'vitest'

import { maskEmail, maskIdentityValue } from '../mask'

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

// maskEmail 的域名泛化回归（2026-11-01）。旧正则只认 `.com/.net/.org`：
// `user@example.cn` 完全不掩码（PII 泄露），其余域名靠「从中间某处开始匹配」
// 才碰巧掩盖，且会把 `@domain` 一起打星。新规则：local 段保留前 1-2 位、其余打星，
// `@domain` 原样。
describe('maskEmail', () => {
  it('任意 TLD（.cn）也掩码 local 段，@domain 原样', () => {
    expect(maskEmail('user@example.cn')).toBe('us**@example.cn')
  })

  it('多级域名原样保留', () => {
    expect(maskEmail('user@mail.example.org')).toBe('us**@mail.example.org')
  })

  it('单字符 local 无可掩部分，原样返回', () => {
    expect(maskEmail('a@b.com')).toBe('a@b.com')
  })

  it('两字符 local 恰好占满保留位，原样返回', () => {
    expect(maskEmail('ab@example.com')).toBe('ab@example.com')
  })

  it('local 含 + 时按字符位保留前 2 位（a+ 保留、其后打星）', () => {
    expect(maskEmail('a+b@example.com')).toBe('a+*@example.com')
  })
})
