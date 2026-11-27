import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AppDemoDTOUpdateRequest } from '../demo.dto'

/** ④（2026-11 F2）：真 PATCH 语义（口径同 F1 的 menu.dto.spec，说明见 dictType 的同名 spec） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / demo：真 partial（preserveAbsent）', () => {
  it('只给 demoString ⇒ 其余列不落键，校验放行', () => {
    const instance = parse(AppDemoDTOUpdateRequest, { demoString: 'ONLY-STRING' })

    expect(Object.keys(instance)).toEqual(['demoString'])
    expect(instance.demoNumber).toBeUndefined()
    expect(instance.demoBoolean).toBeUndefined()
    expect(instance.demoDate).toBeUndefined()
    expect(instance.demoObject).toBeUndefined()
    expect(instance.demoStringArray).toBeUndefined()
    expect(instance.deptId).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('只给 deptId ⇒ 其它列不落键（strip 策略仍负责把它从更新面剔除）', () => {
    const deptId = '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'
    const instance = parse(AppDemoDTOUpdateRequest, { deptId })

    expect(Object.keys(instance)).toEqual(['deptId'])
    expect(instance.deptId).toBe(deptId)
    expect(instance.demoString).toBeUndefined()
  })

  it('显式 null（有意的清空）必须保留', () => {
    const instance = parse(AppDemoDTOUpdateRequest, { demoString: null })

    expect(Object.hasOwn(instance, 'demoString')).toBe(true)
    expect(instance.demoString).toBeNull()
    expect(instance.demoNumber).toBeUndefined()
  })
})
