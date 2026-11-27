import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysDictDataDTOUpdateRequest } from '../dictData.dto'

/** ④（2026-11 F2）：真 PATCH 语义（口径同 F1 的 menu.dto.spec，说明见 dictType 的同名 spec） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / dict data：真 partial（preserveAbsent）', () => {
  it('只给 label ⇒ 其余键不落键，校验放行（typeId 的 uuid 校验不被触发）', () => {
    const instance = parse(SysDictDataDTOUpdateRequest, { label: 'only-label' })

    expect(Object.keys(instance)).toEqual(['label'])
    expect(instance.typeId).toBeUndefined()
    expect(instance.tagType).toBeUndefined()
    expect(instance.order).toBeUndefined()
    expect(instance.status).toBeUndefined()
    expect(instance.description).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('显式 null（有意的清空）必须保留', () => {
    const instance = parse(SysDictDataDTOUpdateRequest, { description: null, value: 'v' })

    expect(Object.hasOwn(instance, 'description')).toBe(true)
    expect(instance.description).toBeNull()
    expect(instance.value).toBe('v')
    expect(instance.label).toBeUndefined()
  })
})
