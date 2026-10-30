import type { IWalnutAdminDataScopeResolveInput, IWalnutAdminDataScopeRoleSnapshot } from './data-scope.resolver'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { describe, expect, it } from 'vitest'
import { resolveSingleRoleDataScope, resolveWalnutDataScopeDescriptor } from './data-scope.resolver'

/**
 * 数据权限解析器矩阵（纯函数，不碰 DB/缓存）。
 *
 * 覆盖 docs/plans/data-scope-design.md §4 设计要点 7 的 multi-role 语义：
 * COMBINE 并集最宽 / SWITCH 仅 currentRole / root 恒 ALL / 无角色默认拒绝 /
 * 非法档位默认拒绝 / 停用角色不参与。
 */

const USER = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_C = '33333333-3333-4333-8333-333333333333'

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
    roleMode: WalnutAdminConstRoleMode.COMBINE,
    currentRoleId: overrides.currentRoleId ?? roles[0]?.id ?? null,
    orderedRoleIds: overrides.orderedRoleIds ?? roles.map(item => item.id),
    customMemberIds: overrides.customMemberIds ?? {},
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
  ])('data_scope=%s → %s', (dataScope, mode) => {
    expect(resolveSingleRoleDataScope(role('r3', 'admin', dataScope)).mode).toBe(mode)
  })

  it('非法档位（列被改坏）→ 默认拒绝，不猜 ALL', () => {
    expect(resolveSingleRoleDataScope(role('r4', 'admin', 99)))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] })
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

  it('combine：SELF + CUSTOM → CUSTOM（本人 ∪ 各 CUSTOM 角色成员）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [
        role('r1', 'a', WalnutAdminConstDataScope.SELF),
        role('r2', 'b', WalnutAdminConstDataScope.CUSTOM),
        role('r3', 'c', WalnutAdminConstDataScope.CUSTOM),
      ],
      customMemberIds: {
        r2: [USER_B],
        r3: [USER_C],
      },
    }))

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.CUSTOM)
    expect(new Set(descriptor.userIds)).toEqual(new Set([USER, USER_B, USER_C]))
  })

  it('combine：全 SELF → SELF', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.SELF)],
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('switch：只看 currentRole（哪怕 junction 里还有 ALL 角色）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('switch：currentRole 是 CUSTOM → CUSTOM（本人 ∪ 该角色成员）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.CUSTOM)],
      currentRoleId: 'r1',
      customMemberIds: { r1: [USER_B] },
    }))

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.CUSTOM)
    expect(new Set(descriptor.userIds)).toEqual(new Set([USER, USER_B]))
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

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] })
  })

  it('无绑定角色 → 默认拒绝（CUSTOM 空集 → SQL 恒假）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roles: [],
      orderedRoleIds: [],
      currentRoleId: null,
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] })
  })

  it('custom 无成员清单 → 至少包含本人（不会退化成空集）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.CUSTOM)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [USER] })
  })

  it('数据权限描述符里的 userIds 去重（角色成员与本人重叠）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      roles: [role('r1', 'a', WalnutAdminConstDataScope.CUSTOM)],
      currentRoleId: 'r1',
      customMemberIds: { r1: [USER, USER, USER_B] },
    }))

    expect(descriptor.userIds).toEqual([USER, USER_B])
  })

  it('未知 roleMode 走保守 SWITCH 分支（只取 currentRole）', () => {
    const descriptor = resolveWalnutDataScopeDescriptor(input({
      roleMode: 'unexpected',
      roles: [role('r1', 'a', WalnutAdminConstDataScope.SELF), role('r2', 'b', WalnutAdminConstDataScope.ALL)],
      currentRoleId: 'r1',
    }))

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })
})
