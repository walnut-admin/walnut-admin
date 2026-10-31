import type { IWalnutAdminDataScopeDescriptor } from '@walnut-server/db'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import {
  applyWalnutDataScopeRlsSettings,
  WALNUT_DATA_SCOPE_RLS_MODE,
} from '@walnut-server/db'
import { describe, expect, it, vi } from 'vitest'
import { buildWalnutDataScopeRlsSettings } from './data-scope.rls'

/**
 * 描述符 → RLS 事务设置的纯函数（三期）。不变量：
 * - ALL 必须映射成独立模式 `all`（不能用空 deptIds 表达全量 —— 空集是拒绝）；
 * - 其余档位一律 `scoped`，deptIds 去重去空；
 * - 无描述符：系统通道 `system`（登录链/心跳），其余匿名 `anonymous`（fail-closed）。
 */
describe('buildWalnutDataScopeRlsSettings', () => {
  const userId = '11111111-1111-4111-8111-111111111111'

  const cases: Array<[string, IWalnutAdminDataScopeDescriptor]> = [
    ['SELF', { mode: WalnutAdminConstDataScopeMode.SELF }],
    ['CUSTOM', { mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: ['d1', 'd1', 'd2', ''] }],
    ['DEPT', { mode: WalnutAdminConstDataScopeMode.DEPT, deptIds: ['d1'] }],
    ['DEPT_AND_CHILD', { mode: WalnutAdminConstDataScopeMode.DEPT_AND_CHILD, deptIds: ['d1', 'd2'] }],
    ['DEPT_OR_SELF', { mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF, deptIds: ['d1'], userIds: [userId] }],
  ]

  it.each(cases)('%s → scoped（部门腿取描述符 deptIds）', (_name, descriptor) => {
    const settings = buildWalnutDataScopeRlsSettings(descriptor, userId)

    expect(settings.mode).toBe(WALNUT_DATA_SCOPE_RLS_MODE.SCOPED)
    expect(settings.userId).toBe(userId)
    expect(settings.deptIds).toEqual([...new Set(descriptor.deptIds ?? [])].filter(id => id !== ''))
  })

  it('all 档位映射成独立模式 all（而不是空 deptIds）', () => {
    const settings = buildWalnutDataScopeRlsSettings(
      { mode: WalnutAdminConstDataScopeMode.ALL },
      userId,
    )

    expect(settings).toEqual({ mode: WALNUT_DATA_SCOPE_RLS_MODE.ALL, userId, deptIds: [], userDeptId: '' })
  })

  it('无描述符：普通匿名请求 → anonymous（fail-closed）', () => {
    expect(buildWalnutDataScopeRlsSettings(undefined, undefined))
      .toEqual({ mode: WALNUT_DATA_SCOPE_RLS_MODE.ANONYMOUS, userId: '', deptIds: [], userDeptId: '' })
  })

  it('无描述符：系统通道（登录链 / 心跳）→ system', () => {
    expect(buildWalnutDataScopeRlsSettings(undefined, undefined, { systemChannel: true }))
      .toEqual({ mode: WALNUT_DATA_SCOPE_RLS_MODE.SYSTEM, userId: '', deptIds: [], userDeptId: '' })
  })

  it('账号部门透传（sys_user / sys_employee 的 WITH CHECK 腿）', () => {
    const settings = buildWalnutDataScopeRlsSettings(
      { mode: WalnutAdminConstDataScopeMode.SELF },
      userId,
      { userDeptId: 'dept-self' },
    )

    expect(settings.userDeptId).toBe('dept-self')
  })

  it('有描述符时 systemChannel 不降级（已登录请求永远按描述符）', () => {
    const settings = buildWalnutDataScopeRlsSettings(
      { mode: WalnutAdminConstDataScopeMode.SELF },
      userId,
      { systemChannel: true },
    )

    expect(settings.mode).toBe(WALNUT_DATA_SCOPE_RLS_MODE.SCOPED)
    expect(settings.userId).toBe(userId)
  })
})

describe('applyWalnutDataScopeRlsSettings', () => {
  it('一条 SELECT 写四个 GUC，deptIds 逗号拼接并去重', async () => {
    const query = vi.fn(async () => undefined)

    await applyWalnutDataScopeRlsSettings({ query } as never, {
      mode: WALNUT_DATA_SCOPE_RLS_MODE.SCOPED,
      userId: 'u1',
      deptIds: ['d1', 'd1', '', 'd2'],
      userDeptId: 'd-own',
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]).toEqual([
      'SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true), set_config($7, $8, true)',
      [
        'app.data_scope.mode',
        'scoped',
        'app.data_scope.user_id',
        'u1',
        'app.data_scope.dept_ids',
        'd1,d2',
        'app.data_scope.user_dept_id',
        'd-own',
      ],
    ])
  })
})
