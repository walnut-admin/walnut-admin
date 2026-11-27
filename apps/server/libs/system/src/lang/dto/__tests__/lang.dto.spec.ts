import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysLangDTOUpdateRequest } from '../lang.dto'

/** ④（2026-11 F2）：真 PATCH 语义（口径同 F1 的 menu.dto.spec，说明见 dictType 的同名 spec） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / lang：真 partial（preserveAbsent）', () => {
  it('只给 description ⇒ lang/order/status 不落键，校验放行', () => {
    const instance = parse(SysLangDTOUpdateRequest, { description: 'only-desc' })

    expect(Object.keys(instance)).toEqual(['description'])
    expect(instance.lang).toBeUndefined()
    expect(instance.order).toBeUndefined()
    expect(instance.status).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('显式 null（有意的清空）必须保留', () => {
    const instance = parse(SysLangDTOUpdateRequest, { description: null, order: 3 })

    expect(Object.hasOwn(instance, 'description')).toBe(true)
    expect(instance.description).toBeNull()
    expect(instance.order).toBe(3)
    expect(instance.lang).toBeUndefined()
  })
})
