import { plainToInstance } from 'class-transformer'
import { describe, expect, it } from 'vitest'
import { AppDemoDTOUpdateRequest } from '@/modules/app/demo/dto/demo.dto'
import { SysEmployeeDTOUpdateRequest } from '@/modules/system/employee/dto/employee.dto'
import { SysUserDTOUpdateRequest } from '@/modules/system/user/dto/user.dto'

/**
 * 数据权限批 4 / B1 回归：三处 deptId 字段关闭了入参 booleanString Transform。
 *
 * 背景：`WalnutAdminDecoratorFieldString` 的 booleanString Transform 对 nil 返回 null，
 * class-transformer 会把它落成**自有属性** —— update 路径就无法区分「未提交 deptId」
 * 与「显式清空部门」（前者应放行、后者在越界时按 40401 拒绝）。这里用与
 * ValidationPipe 相同的 `exposeUnsetFields: false` 直接钉住变换结果。
 */
describe('deptId DTO 入参变换（批 4 / B1 回归）', () => {
  const options = { exposeUnsetFields: false }

  it('未提交 deptId 不产生自有属性（不会被物化成 null）', () => {
    const user = plainToInstance(SysUserDTOUpdateRequest, { userName: 'u' }, options)
    const employee = plainToInstance(SysEmployeeDTOUpdateRequest, { employeeNo: 'e' }, options)
    const demo = plainToInstance(AppDemoDTOUpdateRequest, { demoString: 'X' }, options)

    for (const dto of [user, employee, demo]) {
      expect(Object.hasOwn(dto, 'deptId')).toBe(false)
      expect((dto as { deptId?: unknown }).deptId).toBeUndefined()
    }
  })

  it('显式 null 保留为自有属性（清空语义可与「未提交」区分）', () => {
    const user = plainToInstance(SysUserDTOUpdateRequest, { userName: 'u', deptId: null }, options)
    const demo = plainToInstance(AppDemoDTOUpdateRequest, { demoString: 'X', deptId: null }, options)

    expect(Object.hasOwn(user, 'deptId')).toBe(true)
    expect(user.deptId).toBeNull()
    expect(Object.hasOwn(demo, 'deptId')).toBe(true)
    expect(demo.deptId).toBeNull()
  })

  it('显式值原样保留（大写 UUID 不被改写）', () => {
    const value = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    const user = plainToInstance(SysUserDTOUpdateRequest, { userName: 'u', deptId: value }, options)
    const employee = plainToInstance(SysEmployeeDTOUpdateRequest, { employeeNo: 'e', deptId: value }, options)

    expect(user.deptId).toBe(value)
    expect(employee.deptId).toBe(value)
  })
})
