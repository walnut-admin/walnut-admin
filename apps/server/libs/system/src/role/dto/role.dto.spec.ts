import { randomUUID } from 'node:crypto'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysRoleDTOCreateRequest, SysRoleDTOUpdateRequest } from './role.dto'

/**
 * 批 7 / L6：CUSTOM 部门清单（deptIds）的数量上限回归。
 *
 * 上限 200 在 `SysRoleDTO` 的 `deptIds` 重声明上（`arrayOptions.maxSize`），create /
 * update 两个派生 DTO 共用同一份校验元数据 —— 这里两处都钉住，防止未来单独改某一路
 * 漏掉另一路。199/200 放行、201 拒绝（`arrayMaxSize` 约束），走全局 ValidationPipe
 * 的既有 40099 通道（class-validator 默认消息，不 i18n）。
 *
 * 注意 update 的必填核（roleName/description/order/status 不在 RealPartialType 里）
 * 必须一并回填 —— 与 HTTP 层「PUT 整体替换」口径一致，否则 error 列表里混进 4 条
 * 与上限无关的必填错误。
 */
const REQUIRED_FIELDS = {
  roleName: 'role-name',
  description: 'description',
  order: 1,
  status: true,
}

function buildDeptIds(count: number): string[] {
  return Array.from({ length: count }, () => randomUUID())
}

async function validateDeptIds(DTO: typeof SysRoleDTOCreateRequest | typeof SysRoleDTOUpdateRequest, count: number) {
  const dto = plainToInstance(
    DTO,
    { ...REQUIRED_FIELDS, deptIds: buildDeptIds(count) },
    { exposeUnsetFields: false },
  )
  return validate(dto)
}

function expectArrayMaxSizeOnly(errors: Awaited<ReturnType<typeof validate>>) {
  const deptErrors = errors.filter(error => error.property === 'deptIds')

  expect(deptErrors).toHaveLength(1)
  expect(Object.keys(deptErrors[0].constraints ?? {})).toContain('arrayMaxSize')
}

describe('批 7 / L6：role deptIds 清单上限（200）', () => {
  it.each([199, 200])('update：%i 个部门 id 通过校验（边界内放行）', async (count) => {
    expect(await validateDeptIds(SysRoleDTOUpdateRequest, count)).toHaveLength(0)
  })

  it('update：201 个部门 id → arrayMaxSize 拒绝', async () => {
    expectArrayMaxSizeOnly(await validateDeptIds(SysRoleDTOUpdateRequest, 201))
  })

  it.each([199, 200])('create：%i 个部门 id 通过校验（create 与 update 同源）', async (count) => {
    expect(await validateDeptIds(SysRoleDTOCreateRequest, count)).toHaveLength(0)
  })

  it('create：201 个部门 id → arrayMaxSize 拒绝', async () => {
    expectArrayMaxSizeOnly(await validateDeptIds(SysRoleDTOCreateRequest, 201))
  })

  it('menus 不受 deptIds 上限影响（批 7 评估：菜单全量授权是合法场景，不设限）', async () => {
    const dto = plainToInstance(
      SysRoleDTOUpdateRequest,
      { ...REQUIRED_FIELDS, menus: Array.from({ length: 201 }, () => randomUUID()) },
      { exposeUnsetFields: false },
    )

    expect(await validate(dto)).toHaveLength(0)
  })
})
