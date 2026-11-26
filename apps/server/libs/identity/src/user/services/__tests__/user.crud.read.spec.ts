import type { EntityManager } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'
import { SysUserCrudService } from '../user.crud.service'

/**
 * ③（2026-11）：`GET /system/user/:id` 的 `roles` 直出。
 *
 * 判据：read 在 `attachPopulatedRoles` 的 roles_list 之上派生出 uuid 数组 `roles`
 * （与 create/update 回显同型），不再额外查库；roles_list / roles_count 原样保留。
 */

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ROLE_A = '22222222-2222-4222-8222-222222222222'
const ROLE_B = '33333333-3333-4333-8333-333333333333'
const EM = { marker: 'entity-manager' } as unknown as EntityManager

describe('userCrudService.read：roles 直出（③）', () => {
  it('roles = roles_list.map(id)，roles_list / roles_count 不动', async () => {
    const readById = vi.fn(async () => ({ id: USER_ID, userName: 'alice' }))
    const attachPopulatedRoles = vi.fn(async (user: Record<string, unknown>) => Object.assign(user, {
      roles_list: [{ id: ROLE_A, roleName: 'a' }, { id: ROLE_B, roleName: 'b' }],
      roles_count: 2,
    }))

    const service = new SysUserCrudService(
      { readById } as never,
      { attachPopulatedRoles } as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const read = await service.read(USER_ID, EM) as unknown as Record<string, unknown>

    expect(readById).toHaveBeenCalledExactlyOnceWith(USER_ID, EM)
    expect(read.roles).toEqual([ROLE_A, ROLE_B])
    expect(read.roles_count).toBe(2)
    expect(read.roles_list).toHaveLength(2)
  })
})
