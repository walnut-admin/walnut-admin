import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { describe, expect, it } from 'vitest'
import {
  buildRoleAuthorizationAuditAfter,
  buildRoleAuthorizationAuditSnapshot,
} from '../role.audit'

/**
 * 批 7 / L7：role:update 审计快照组装的纯函数回归 —— 有变更 / 无变更 / 部分字段
 * （dto 只给一半数组）三种形态，以及 junction 读出顺序不稳定时的排序归一。
 * 档位值消费契约常量（批 5 收口），不写字面量。
 */
const roleRow = { dataScope: WalnutAdminConstDataScope.ALL, status: true }

describe('批 7 / L7：role 授权敏感面审计快照组装', () => {
  it('无变更：dto 未给数组 → after 与 before 完全一致', () => {
    const before = buildRoleAuthorizationAuditSnapshot(roleRow, ['dept-b', 'dept-a'], ['menu-b', 'menu-a'])

    expect(before).toEqual({
      dataScope: WalnutAdminConstDataScope.ALL,
      status: true,
      deptIds: ['dept-a', 'dept-b'],
      menus: ['menu-a', 'menu-b'],
    })

    const after = buildRoleAuthorizationAuditAfter(
      { dataScope: WalnutAdminConstDataScope.CUSTOM, status: true },
      before,
      {},
    )

    // 角色行两列取新值；未提交的 junction 两腿沿用 before（等同未变更）
    expect(after).toEqual({
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      status: true,
      deptIds: ['dept-a', 'dept-b'],
      menus: ['menu-a', 'menu-b'],
    })
  })

  it('有变更：dataScope/status 翻转 + 两个数组整组替换', () => {
    const before = buildRoleAuthorizationAuditSnapshot(roleRow, ['dept-a'], ['menu-a'])

    const after = buildRoleAuthorizationAuditAfter(
      { dataScope: WalnutAdminConstDataScope.DEPT, status: false },
      before,
      { deptIds: ['dept-c', 'dept-b'], menus: ['menu-c'] },
    )

    expect(after).toEqual({
      dataScope: WalnutAdminConstDataScope.DEPT,
      status: false,
      deptIds: ['dept-b', 'dept-c'],
      menus: ['menu-c'],
    })
  })

  it('部分字段：dto 只给 deptIds → menus 沿用 before，deptIds 整组替换（含显式清空）', () => {
    const before = buildRoleAuthorizationAuditSnapshot(roleRow, ['dept-a'], ['menu-a', 'menu-b'])

    const after = buildRoleAuthorizationAuditAfter(roleRow, before, { deptIds: [] })

    expect(after.deptIds).toEqual([])
    expect(after.menus).toEqual(['menu-a', 'menu-b'])
    expect(after.dataScope).toBe(before.dataScope)
    expect(after.status).toBe(before.status)
  })

  it('junction 读出顺序不稳定 → 排序归一，不产生假 diff', () => {
    const a = buildRoleAuthorizationAuditSnapshot(roleRow, ['x', 'y', 'z'], ['1', '2'])
    const b = buildRoleAuthorizationAuditSnapshot(roleRow, ['z', 'x', 'y'], ['2', '1'])

    expect(a).toEqual(b)
  })
})
