import type { IWalnutAdminDataScopeDescriptor, IWalnutAdminDataScopeRlsSettings } from '@walnut-server/db'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WALNUT_DATA_SCOPE_RLS_MODE } from '@walnut-server/db'

/**
 * 数据权限描述符 → PostgreSQL RLS 事务设置（三期）。
 *
 * 为什么单独一层：描述符是**应用层可见明细**（SELF 只看本人、DEPT 只看部门…），
 * RLS 设置是**数据库层天花板** —— 两者形状不同、但必须同源：
 * - ALL → 天花板 `all`（策略放行全部行；root / runAsSystem）；
 * - 其余档位 → `scoped`，部门腿取描述符已展开的 `deptIds`（SELF 为空集，策略仅
 *   owner 腿生效）；owner 腿由当前 userId 提供；
 * - 无描述符：
 *   - 系统通道（登录链 / 在线监控心跳等显式标记的处理器）→ `system`（放行）；
 *   - 其余匿名 HTTP 请求 → `anonymous`（策略拒绝，fail-closed 0 行）。
 *
 * 不变量：应用层算出的可见集合必须 ⊆ RLS 允许集合（天花板不小于明细）。
 * 两个反例都已逐条对齐：`allowAnonymous` 实体在策略里补 `owner IS NULL`；
 * ALL 用独立模式而不是「空 deptIds」（空集是拒绝，不是全量）。
 */
export function buildWalnutDataScopeRlsSettings(
  descriptor: IWalnutAdminDataScopeDescriptor | undefined,
  userId: string | undefined,
  options: { systemChannel?: boolean, userDeptId?: string | null } = {},
): IWalnutAdminDataScopeRlsSettings {
  const userDeptId = options.userDeptId ?? ''

  if (descriptor !== undefined) {
    if (descriptor.mode === WalnutAdminConstDataScopeMode.ALL) {
      return {
        mode: WALNUT_DATA_SCOPE_RLS_MODE.ALL,
        userId: userId ?? '',
        deptIds: [],
        userDeptId,
      }
    }

    return {
      mode: WALNUT_DATA_SCOPE_RLS_MODE.SCOPED,
      userId: userId ?? '',
      deptIds: [...new Set((descriptor.deptIds ?? []).filter(id => typeof id === 'string' && id !== ''))],
      userDeptId,
    }
  }

  return {
    mode: options.systemChannel === true
      ? WALNUT_DATA_SCOPE_RLS_MODE.SYSTEM
      : WALNUT_DATA_SCOPE_RLS_MODE.ANONYMOUS,
    userId: '',
    deptIds: [],
    userDeptId: '',
  }
}
