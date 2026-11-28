import { randomUUID } from 'node:crypto'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysRoleDTOCreateRequest, SysRoleDTOUpdateRequest } from '../role.dto'

/**
 * 批 7 / L6：CUSTOM 部门清单（deptIds）的数量上限回归。
 *
 * 上限 200 在 `SysRoleDTO` 的 `deptIds` 重声明上（`arrayOptions.maxSize`），create /
 * update 两个派生 DTO 共用同一份校验元数据 —— 这里两处都钉住，防止未来单独改某一路
 * 漏掉另一路。199/200 放行、201 拒绝（`arrayMaxSize` 约束），走全局 ValidationPipe
 * 的既有 40099 通道（class-validator 默认消息，不 i18n）。
 *
 * 注意 create 的必填核（roleName/description/order/status）必须一并回填；
 * update 自 2026-11 F2 起是全字段可选的 preserveAbsent DTO（见文件末尾的语义用例），
 * 这里仍回填同一组字段 —— 只为让两类 DTO 共用同一份构造器，边界值不受影响。
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

async function validateDeptIds(
  DTO: typeof SysRoleDTOCreateRequest | typeof SysRoleDTOUpdateRequest,
  count: number,
) {
  const dto = plainToInstance(
    DTO,
    { ...REQUIRED_FIELDS, deptIds: buildDeptIds(count) },
    { exposeUnsetFields: false },
  )
  return validate(dto)
}

function expectArrayMaxSizeOnly(errors: Awaited<ReturnType<typeof validate>>) {
  const deptErrors = errors.filter((error) => error.property === 'deptIds')

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

/**
 * ④（2026-11 F2）：真 PATCH 语义（`RealPartialType(..., { preserveAbsent: true })`）。
 * 口径与 F1 的 menu.dto.spec 一致：未提供的键保持 undefined，显式 null 保留。
 */
function parseUpdate(body: Record<string, unknown>) {
  return plainToInstance(SysRoleDTOUpdateRequest, body, { exposeUnsetFields: false }) as Record<
    string,
    unknown
  >
}

describe('update DTO / role：真 partial（preserveAbsent）', () => {
  it('只给 roleName ⇒ 其余键不落键（menus/dataScope/deptIds 不提供 = 不动），校验放行', async () => {
    const instance = parseUpdate({ roleName: 'only-name' })

    expect(Object.keys(instance)).toEqual(['roleName'])
    expect(instance.description).toBeUndefined()
    expect(instance.order).toBeUndefined()
    expect(instance.status).toBeUndefined()
    expect(instance.menus).toBeUndefined()
    expect(instance.dataScope).toBeUndefined()
    expect(instance.deptIds).toBeUndefined()
    expect(await validate(instance)).toHaveLength(0)
  })

  it('只给 menus ⇒ 角色行标量列不落键（授权整组替换不影响其它字段）', () => {
    const menuId = randomUUID()
    const instance = parseUpdate({ menus: [menuId] })

    expect(Object.keys(instance)).toEqual(['menus'])
    expect(instance.menus).toEqual([menuId])
    expect(instance.roleName).toBeUndefined()
    expect(instance.status).toBeUndefined()
  })

  it('显式 null（有意的清空）必须保留', () => {
    const instance = parseUpdate({ description: null })

    expect(Object.hasOwn(instance, 'description')).toBe(true)
    expect(instance.description).toBeNull()
    expect(instance.roleName).toBeUndefined()
  })
})
