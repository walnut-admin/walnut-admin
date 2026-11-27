import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysUserDTOUpdateRequest } from '../user.dto'

/** ④（2026-11 F2）：真 PATCH 语义（口径同 F1 的 menu.dto.spec，说明见 dictType 的同名 spec） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / user：真 partial（preserveAbsent）', () => {
  it('只给 status ⇒ userName/roles/deptId 不落键（roles 未给 = junction 不动），校验放行', () => {
    const instance = parse(SysUserDTOUpdateRequest, { status: false })

    expect(Object.keys(instance)).toEqual(['status'])
    expect(instance.userName).toBeUndefined()
    expect(instance.roles).toBeUndefined()
    expect(instance.deptId).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('只给 roles ⇒ 其余列不落键', () => {
    const roleId = '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'
    const instance = parse(SysUserDTOUpdateRequest, { roles: [roleId] })

    expect(Object.keys(instance)).toEqual(['roles'])
    expect(instance.roles).toEqual([roleId])
    expect(instance.userName).toBeUndefined()
    expect(instance.status).toBeUndefined()
  })

  it('显式 null（有意的清空 deptId）必须保留', () => {
    const instance = parse(SysUserDTOUpdateRequest, { deptId: null })

    expect(Object.hasOwn(instance, 'deptId')).toBe(true)
    expect(instance.deptId).toBeNull()
    expect(instance.roles).toBeUndefined()
  })
})
