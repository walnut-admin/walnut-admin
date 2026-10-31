import type { IWalnutAdminDataScopeResolveInput, IWalnutAdminDataScopeRoleSnapshot } from './data-scope.resolver'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { describe, expect, it } from 'vitest'
import { resolveSingleRoleDataScope, resolveWalnutDataScopeDescriptor } from './data-scope.resolver'

/**
 * 数据权限解析器矩阵（纯函数，不碰 DB/缓存）。
 *
 * 覆盖 docs/plans/data-scope-phase2-3-plan.md §1.1 的六档语义与
 * docs/plans/data-scope-design.md §4 设计要点 7 的 multi-role 语义：
 * COMBINE 部门并集 / SWITCH 仅 currentRole / root 恒 ALL / 无角色默认拒绝 /
 * 非法档位默认拒绝 / 停用角色不参与 / dept NULL 默认拒绝 / CUSTOM 部门清单。
 */

const USER = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_C = '33333333-3333-4333-8333-333333333333'

const DEPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEPT_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEPT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function role(
  id: string,
  roleName: string,
  dataScope: number,
  status = true,
): IWalnutAdminDataScopeRoleSnapshot {
  return { id, roleName, dataScope, status }
}

function input(
  overrides: Partial<IWalnutAdminDataScopeResolveInput> & Pick<IWalnutAdminDataScopeResolveInput, 'roles'>,
): IWalnutAdminDataScopeResolveInput {
  const roles = overrides.roles
  return {
    userId: USER,
    userDeptId: DEPT_A,
    userDeptSubtreeIds: [DEPT_A, DEPT_CHILD],
    roleMode: WalnutAdminConstRoleMode.COMBINE,
    currentRoleId: overrides.currentRoleId ?? roles[0]?.id ?? null,
    orderedRoleIds: overrides.orderedRoleIds ?? roles.map(item => item.id),
    customDeptIds: overrides.customDeptIds ?? {},
    ...overrides,
    roles,
  }
}

describe('resolveSingleRoleDataScope（单角色：契约角色优先于 data_scope 列）', () => {
  it('root → ALL（无论列值）', () => {
    expect(resolveSingleRoleDataScope(role('r1', 'root', WalnutAdminConstDataScope.SELF)))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
  })

  it('visitor → SELF（guard 对 visitor 放行所有 list/read，必须防止默认 ALL 变成全量读）', () => {
    expect(resolveSingleRoleDataScope(role('r2', 'visitor', WalnutAdminConstDataScope.ALL)))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it.each([
    [WalnutAdminConstDataScope.ALL, WalnutAdminConstDataScopeMode.ALL],
    [WalnutAdminConstDataScope.SELF, WalnutAdminConstDataScopeMode.SELF],
    [WalnutAdminConstDataScope.CUSTOM, WalnutAdminConstDataScopeMode.CUSTOM],
    [WalnutAdminConstDataScope.DEPT, WalnutAdminConstDataScopeMode.DEPT],
    [WalnutAdminConstDataScope.DEPT_AND_CHILD, WalnutAdminConstDataScopeMode.DEPT_AND_CHILD],
    [WalnutAdminConstDataScope.DEPT_OR_SELF, WalnutAdminConstDataScopeMode.DEPT_OR_SELF],
  ])('data_scope=%s → %s', (dataScope, mode) => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', dataScope), {
      userId: USER,
      userDeptId: DEPT_A,
      userDeptSubtreeIds: [DEPT_A, DEPT_CHILD],
      customDeptIds: [DEPT_B],
    }).mode).toBe(mode)
  })

  it('custom → sys_role_dept 部门清单（去重；不递归子树）', () => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.CUSTOM), {
      userId: USER,
      userDeptId: DEPT_A,
      customDeptIds: [DEPT_B, DEPT_B, ''],
    })).toEqual({
      mode: WalnutAdminConstDataScopeMode.CUSTOM,
      deptIds: [DEPT_B],
    })
  })

  it('dept → [user.dept_id]', () => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT), {
      userId: USER,
      userDeptId: DEPT_B,
    })).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT,
      deptIds: [DEPT_B],
    })
  })

  it('dept_and_child → 预解析的子树（含自身）', () => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT_AND_CHILD), {
      userId: USER,
      userDeptId: DEPT_A,
      userDeptSubtreeIds: [DEPT_A, DEPT_CHILD],
    })).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_AND_CHILD,
      deptIds: [DEPT_A, DEPT_CHILD],
    })
  })

  it('dept_or_self → 子树 + 本人腿', () => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT_OR_SELF), {
      userId: USER,
      userDeptId: DEPT_A,
      userDeptSubtreeIds: [DEPT_A, DEPT_CHILD],
    })).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
      deptIds: [DEPT_A, DEPT_CHILD],
      userIds: [USER],
    })
  })

  it('dept 为 NULL → DEPT 系档位空集（默认拒绝；DEPT_OR_SELF 保留本人腿）', () => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT), {
      userId: USER,
      userDeptId: null,
    })).toEqual({ mode: WalnutAdminConstDataScopeMode.DEPT, deptIds: [] })

    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT_AND_CHILD), {
      userId: USER,
      userDeptId: null,
      userDeptSubtreeIds: [DEPT_A],
    })).toEqual({ mode: WalnutAdminConstDataScopeMode.DEPT_AND_CHILD, deptIds: [] })

    expect(resolveSingleRoleDataScope(role('r3', 'admin', WalnutAdminConstDataScope.DEPT_OR_SELF), {
      userId: USER,
      userDeptId: null,
      userDeptSubtreeIds: [DEPT_A],
    })).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
      deptIds: [],
      userIds: [USER],
    })
  })

  it('非法档位（列被改坏）→ 默认拒绝，不猜 ALL', () => {
    expect(resolveSingleRoleDataScope(role('r4', 'admin', 99)))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
  })
})

describe('resolveWalnutDataScopeDescriptor（多角色语义）', () => {
  it('combine：任一 root 角色 → ALL', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'admin', WalnutAdminConstDataScope.SELF), role('r2', 'root', WalnutAdminConstDataScope.SELF)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
  })

  it('combine：任一 ALL → ALL（最宽优先）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
  })

  it('combine：DEPT + SELF → DEPT_OR_SELF（部门面 ∪ 本人腿）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT),
        role('r2', 'b', WalnutAdminConstDataScope.SELF),
      ],
    }))

    expect(descriptor).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
      deptIds: [DEPT_A],
      userIds: [USER],
    })
  })

  it('combine：多个部门档位取 deptIds 并集（DEPT ∪ DEPT_AND_CHILD）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT),
        role('r2', 'b', WalnutAdminConstDataScope.DEPT_AND_CHILD),
      ],
    }))

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.DEPT)
    expect(new Set(descriptor.deptIds)).toEqual(new Set([DEPT_A, DEPT_CHILD]))
  })

  it('combine：CUSTOM 清单与 DEPT 并集', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT),
        role('r2', 'b', WalnutAdminConstDataScope.CUSTOM),
        role('r3', 'c', WalnutAdminConstDataScope.CUSTOM),
      ],
      customDeptIds: {
        r2: [DEPT_B],
        r3: [DEPT_B, DEPT_CHILD],
      },
    }))

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.DEPT)
    expect(new Set(descriptor.deptIds)).toEqual(new Set([DEPT_A, DEPT_B, DEPT_CHILD]))
  })

  it('combine：DEPT_OR_SELF + DEPT → DEPT_OR_SELF（并集 + 本人腿）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT_OR_SELF),
        role('r2', 'b', WalnutAdminConstDataScope.DEPT),
      ],
    }))

    expect(descriptor).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
      deptIds: [DEPT_A, DEPT_CHILD],
      userIds: [USER],
    })
  })

  it('combine：全 SELF → SELF', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.SELF)],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('combine：dept 为 NULL 的部门档位 + SELF → SELF（不退化空集）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      userDeptId: null,
      userDeptSubtreeIds: [],
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT),
        role('r2', 'b', WalnutAdminConstDataScope.SELF),
      ],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('combine：CUSTOM 空清单且无 SELF → 默认拒绝', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.CUSTOM)],
      customDeptIds: { r1: [] },
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
  })

  it('switch：只看 currentRole（哪怕 junction 里还有 ALL 角色）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('switch：currentRole 是 CUSTOM → 该角色的部门清单（与成员无关）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.CUSTOM)],
      currentRoleId: 'r1',
      customDeptIds: { r1: [DEPT_B] },
    }))

    expect(descriptor).toEqual({
      mode: WalnutAdminConstDataScopeMode.CUSTOM,
      deptIds: [DEPT_B],
    })
  })

  it('switch：currentRole 是 DEPT_AND_CHILD → 子树', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.DEPT_AND_CHILD)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_AND_CHILD,
      deptIds: [DEPT_A, DEPT_CHILD],
    })
  })

  it('switch：currentRole 是 root → ALL', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'root', WalnutAdminConstDataScope.SELF)],
      currentRoleId: 'r2',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
  })

  it('switch：currentRole 已脱钩 → 回退 junction 首角色（与 getCoreMenus 同口径）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
      currentRoleId: 'missing-role',
      orderedRoleIds: ['r1', 'r2'],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('停用角色不参与解析（只剩停用角色时默认拒绝）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.ALL, false)],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
  })

  it('无绑定角色 → 默认拒绝（CUSTOM 空集 → SQL 恒假）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roles: [],
      orderedRoleIds: [],
      currentRoleId: null,
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
  })

  it('dEPT_OR_SELF 的 userIds 去重', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT_OR_SELF),
        role('r2', 'b', WalnutAdminConstDataScope.SELF),
      ],
      currentRoleId: 'r1',
    }))

    expect(descriptor.userIds).toEqual([USER])
  })

  it('未知 roleMode 走保守 SWITCH 分支（只取 currentRole）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: 'unexpected',
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('用户 id 只在 SELF 腿出现（部门并集不会把其他 user 带进来）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.DEPT_AND_CHILD),
        role('r2', 'b', WalnutAdminConstDataScope.SELF),
      ],
    }))

    expect(descriptor.userIds).toEqual([USER])
    expect(descriptor.userIds).not.toContain(USER_B)
    expect(descriptor.userIds).not.toContain(USER_C)
  })
})
