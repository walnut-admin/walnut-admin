import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AppSettingDTOUpdateRequest } from '../setting.dto'

/** ④（2026-11 F2）：真 PATCH 语义（口径同 F1 的 menu.dto.spec，说明见 dictType 的同名 spec） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / setting：真 partial（preserveAbsent）', () => {
  it('只给 settingValue ⇒ 其余键不落键，校验放行', () => {
    const instance = parse(AppSettingDTOUpdateRequest, { settingValue: 'only-value' })

    expect(Object.keys(instance)).toEqual(['settingValue'])
    expect(instance.settingKey).toBeUndefined()
    expect(instance.settingName).toBeUndefined()
    expect(instance.settingType).toBeUndefined()
    expect(instance.remark).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('显式 null（有意的清空）必须保留', () => {
    const instance = parse(AppSettingDTOUpdateRequest, { remark: null })

    expect(Object.hasOwn(instance, 'remark')).toBe(true)
    expect(instance.remark).toBeNull()
    expect(instance.settingKey).toBeUndefined()
  })
})
