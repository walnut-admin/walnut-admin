import { describe, expect, it } from 'vitest'

import { getDeviceLocationString } from './device-location'

// libs 解耦批 6 随身份内核下沉的纯函数（原 device.entity 的 getLocationString PG 等价物）。
// 钉 locationInfo 缺省、region===city 去重、country 缺省被 filter(Boolean) 丢弃三条语义。

describe('getDeviceLocationString', () => {
  it('locationInfo 为 null / 缺省 → Unknown', () => {
    expect(getDeviceLocationString({ locationInfo: null })).toBe('Unknown')
    expect(getDeviceLocationString({})).toBe('Unknown')
  })

  it('国市区齐全 → 空格拼接', () => {
    expect(getDeviceLocationString({ locationInfo: { country: '中国', region: '广东', city: '深圳' } })).toBe('中国 广东 深圳')
  })

  it('region === city → 去重（国 + 区）', () => {
    expect(getDeviceLocationString({ locationInfo: { country: '中国', region: '深圳', city: '深圳' } })).toBe('中国 深圳')
  })

  it('country 缺省 → filter(Boolean) 丢弃，不打 undefined', () => {
    expect(getDeviceLocationString({ locationInfo: { region: '广东', city: '深圳' } })).toBe('广东 深圳')
  })
})
