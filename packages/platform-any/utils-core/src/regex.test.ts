import { describe, expect, it } from 'vitest'

import { isEmailAddress, isPhoneNumber } from './regex'

describe('isEmailAddress', () => {
  it('accepts common address forms', () => {
    expect(isEmailAddress('a@b.com')).toBe(true)
    expect(isEmailAddress('user.name+tag@example.co.uk')).toBe(true)
    expect(isEmailAddress('"quoted"@example.com')).toBe(true)
    expect(isEmailAddress('u@[192.168.0.1]')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    expect(isEmailAddress('plainaddress')).toBe(false)
    expect(isEmailAddress('missing@tld')).toBe(false) // domain requires a dot or IP literal
    expect(isEmailAddress('a@b')).toBe(false)
    expect(isEmailAddress('@nouser.com')).toBe(false)
    expect(isEmailAddress('user@')).toBe(false)
    expect(isEmailAddress('user name@example.com')).toBe(false)
    expect(isEmailAddress('')).toBe(false)
  })
})

describe('isPhoneNumber', () => {
  it('accepts international formats', () => {
    expect(isPhoneNumber('+8613800138000')).toBe(true)
    expect(isPhoneNumber('+14155552671')).toBe(true)
    expect(isPhoneNumber('+442083661177')).toBe(true)
    expect(isPhoneNumber('+14155552671')).toBe(true)
  })

  it('rejects non-phone strings', () => {
    expect(isPhoneNumber('12345')).toBe(false) // missing leading +
    expect(isPhoneNumber('abc')).toBe(false)
    expect(isPhoneNumber('')).toBe(false)
    expect(isPhoneNumber('+86123abc')).toBe(false)
    expect(isPhoneNumber('++8613800138000')).toBe(false)
  })
})
