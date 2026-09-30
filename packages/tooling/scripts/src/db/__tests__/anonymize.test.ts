/**
 * `anonymize.ts` 的用例。
 *
 * 三条判据都要能证明自己**会红**，因为脱敏的失效方式是"看不出失效"：
 *
 * 1. **该掩的确实掩了** —— 尤其是键名毫无提示性的字段（`sys_user_identity.value` 里装的其实是
 *    明文邮箱与手机号，实测第一版就漏了它）；
 * 2. **不该动的一个字不动** —— 第一版把 `menus: ['m1']` 掩成了 `<redacted>`（把所有数组元素都
 *    当敏感值），对照组当场抓到；
 * 3. **坐标降精度**（城市级）—— 全精度经纬度等于精确住址，但直接掩掉又没法排查。
 */
import { describe, expect, it } from 'vitest'
import {
  anonymizeDocs,
  findUnmaskedPersonal,
  isSensitiveKey,
  looksLikePhone,
  maskDocument,
  maskEmail,
  maskIp,
  maskPhone,
} from '../anonymize.ts'

describe('掩码形态', () => {
  it('邮箱保留首字母与域名，手机保留前 3 后 4，IP 保留网段', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com')
    expect(maskPhone('13800001111')).toBe('138****1111')
    expect(maskPhone('+86 138 0000 1111')).toBe('861****1111')
    expect(maskIp('203.0.113.7')).toBe('203.0.*.*')
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:*:*:*:*:*:*')
  })

  it('手机号判定刻意收紧：普通数字串不该被当成手机号', () => {
    expect(looksLikePhone('13800001111')).toBe(true)
    expect(looksLikePhone('+8613800001111')).toBe(true)
    // 这些是普通数字串（字典值 / 时间戳 / 端口），掩掉就是误伤
    expect(looksLikePhone('1000000')).toBe(false)
    expect(looksLikePhone('1759457540883')).toBe(false)
  })
})

describe('键名判定', () => {
  it('敏感键名认得出来；普通键名不误伤', () => {
    for (const key of ['deviceId', 'ip', 'ipHistory', 'locationInfo', 'geoLocation', 'email', 'phoneNumber', 'valueHash', 'totpSecretCiphertext', 'webauthnPublicKey', 'avatar'])
      expect(isSensitiveKey(key), key).toBe(true)
    for (const key of ['roleName', 'title', 'description', 'userName', 'menus', 'status'])
      expect(isSensitiveKey(key), key).toBe(false)
  })
})

describe('文档脱敏', () => {
  it('敏感键上的值被掩；普通键上的普通值一个字不动（`menus: [\'m1\']` 那种误伤不再发生）', () => {
    const doc = { _id: 'r1', roleName: 'visitor', description: '游览角色', menus: ['m1'], status: true }
    expect(maskDocument(doc)).toEqual(doc)
  })

  it('键名没提示但值是 PII 形态时**兜底掩掉**（`sys_user_identity.value` 实测漏过）', () => {
    const masked = maskDocument({ _id: 'i1', value: 'alice@example.com', value2: '13800001111' })
    expect(masked.value).toBe('a***@example.com')
    expect(masked.value2).toBe('138****1111')
  })

  it('敏感键里的数组逐个掩（ipHistory）', () => {
    const masked = maskDocument({ ipHistory: ['203.0.113.7', '198.51.100.23'] })
    expect(masked.ipHistory).toEqual(['203.0.*.*', '198.51.*.*'])
  })

  it('坐标降精度到一位小数（城市级）；`deviceName` 这类设备型号**照样要掩**，普通备注不动', () => {
    const masked = maskDocument({ geoLocation: { lat: 39.9042, lng: 116.4074 }, deviceName: 'MacBook Pro', remark: '备注' })
    expect(masked.geoLocation).toEqual({ lat: 39.9, lng: 116.4 })
    // 设备型号也是指纹数据（`/^device/` 命中），这里刻意钉住"它会被掩"
    expect(masked.deviceName).toBe('<redacted:11>')
    expect(masked.remark).toBe('备注')
  })

  it('不透明串只保留长度（形状变了能一眼看出来）', () => {
    const masked = maskDocument({ deviceId: 'fp_9f2c41ab77de5510', webauthnCredentialId: 'Zm9vYmFyYmF6cXV4' })
    expect(masked.deviceId).toBe('<redacted:19>')
    expect(masked.webauthnCredentialId).toBe('<redacted:16>')
  })

  it('嵌套结构里的敏感键也能找到（不只看第一层）', () => {
    const masked = maskDocument({ meta: { nested: { deviceId: 'fp_abcdefgh12345678' } } }) as { meta: { nested: { deviceId: string } } }
    expect(masked.meta.nested.deviceId).toBe('<redacted:19>')
  })

  it('不改原对象（导出时还要拿原值做别的）', () => {
    const doc = { deviceId: 'fp_9f2c41ab77de5510' }
    maskDocument(doc)
    expect(doc.deviceId).toBe('fp_9f2c41ab77de5510')
  })
})

describe('自检（门禁用）', () => {
  it('能点出未脱敏的个人数据字段路径', () => {
    const hits = findUnmaskedPersonal({ _id: 'd1', ip: '203.0.113.7', meta: { deviceId: 'fp_abcdefgh12345678' } })
    expect(hits).toEqual(['ip=203.0.113.7', 'meta.deviceId=fp_abcdefgh12345678'])
  })

  it('脱敏后的文档自检为空', () => {
    const docs = anonymizeDocs([
      { _id: 'd1', ip: '203.0.113.7', deviceId: 'fp_9f2c41ab77de5510' },
      { _id: 'i1', value: 'alice@example.com' },
    ])
    expect(docs.flatMap(d => findUnmaskedPersonal(d))).toEqual([])
  })
})
