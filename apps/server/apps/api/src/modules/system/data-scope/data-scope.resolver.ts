import type { IWalnutAdminDataScopeDescriptor } from '@/common/repository/data-scope'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Role } from '@walnut/contract'
import { toWalnutDataScopeMode } from '@/common/repository/data-scope'

/**
 * 数据权限**解析器**（纯函数）—— 输入 = 用户 junction 角色快照 + 各角色 dataScope，
 * 输出 = 描述符。决策层不碰 DB/缓存，可完整单测（docs/plans/data-scope-design.md
 * §4 设计要点 1 / §7「残余过滤条件接口」：未来接 OPA/策略引擎只换这一层）。
 *
 * 语义（沿用 roleMode）：
 * - root 恒 ALL（COMBINE 下任一角色为 root；SWITCH 下 currentRole 为 root）；
 * - COMBINE：所有启用角色的档位取**并集最宽** —— 任一 ALL → ALL；否则把 SELF 的
 *   「本人」与 CUSTOM 的成员清单并起来 → CUSTOM；只有 SELF → SELF；
 * - SWITCH：只看 currentRole（失效时回退 junction 首角色，与 getCoreMenus 同口径）；
 * - 无启用角色 / 非法档位 → 默认拒绝（CUSTOM 空集 → SQL 恒假）。
 *
 * visitor 特例：permission.guard 对 visitor 放行所有 `:list` / `:read`，若按角色行里的
 * data_scope 走（默认 ALL）会让游客读全量业务表；游客账号本身没有业务行，这里固定
 * 按 SELF（等价「看不到任何他人数据」）。与 `SysMenuSharedService` 对 visitor 的
 * 特殊处理同一层语义。
 */

export interface IWalnutAdminDataScopeRoleSnapshot {
  id: string
  roleName: string
  /** 停用角色不参与数据权限（与权限计算过滤 status 同口径） */
  status: boolean
  /** `sys_role.data_scope` 原始 smallint（1/2/3） */
  dataScope: number
}

export interface IWalnutAdminDataScopeResolveInput {
  /** 当前用户（SELF 的本人；CUSTOM 结果恒包含他） */
  userId: string
  /**
   * effective roleMode（`SharedScopeResolverService.resolve(functionalRole, user)` 的
   * 结果，与 getCoreMenus 同口径 —— GLOBAL 配置下恒 switchable）。
   */
  roleMode: string
  /** 用户行 `current_role_id`（SWITCH 的当前角色） */
  currentRoleId: string | null
  /** junction 绑定顺序（`findRoleIdsByUserId` 已按 roleId 排序，保证回退确定） */
  orderedRoleIds: string[]
  /** 全部绑定角色（status/dataScope 是真值） */
  roles: IWalnutAdminDataScopeRoleSnapshot[]
  /** roleId → 该角色绑定的 userIds（只有 CUSTOM 角色需要；缺省按空集） */
  customMemberIds?: Record<string, string[]>
}

export const WALNUT_DATA_SCOPE_DENY: IWalnutAdminDataScopeDescriptor = {
  mode: WalnutAdminConstDataScopeMode.CUSTOM,
  userIds: [],
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(id => typeof id === 'string' && id !== ''))]
}

/**
 * 角色行 → 该角色单独给出的 scope 面（不含多角色合并）：
 * root/visitor 两个契约角色优先于 data_scope 列。
 */
export function resolveSingleRoleDataScope(
  role: IWalnutAdminDataScopeRoleSnapshot,
): IWalnutAdminDataScopeDescriptor {
  if (role.roleName === Role.ROOT) {
    return { mode: WalnutAdminConstDataScopeMode.ALL }
  }

  if (role.roleName === Role.VISITOR) {
    return { mode: WalnutAdminConstDataScopeMode.SELF }
  }

  const mode = toWalnutDataScopeMode(role.dataScope)

  if (mode === null) {
    // 非法档位（列被手工改坏）→ 默认拒绝，不猜 ALL
    return WALNUT_DATA_SCOPE_DENY
  }

  return { mode }
}

export function resolveWalnutDataScopeDescriptor(
  input: IWalnutAdminDataScopeResolveInput,
): IWalnutAdminDataScopeDescriptor {
  const activeById = new Map(
    input.roles
      .filter(role => role.status)
      .map(role => [role.id, role]),
  )

  // junction 顺序优先；不在绑定集里的角色 id 不参与
  const orderedActiveRoles = input.orderedRoleIds
    .map(id => activeById.get(id))
    .filter((role): role is IWalnutAdminDataScopeRoleSnapshot => role !== undefined)

  if (orderedActiveRoles.length === 0) {
    return WALNUT_DATA_SCOPE_DENY
  }

  if (input.roleMode === WalnutAdminConstRoleMode.COMBINE) {
    // 任一 root → ALL（root 是超级角色，junction 里存在即全量）
    if (orderedActiveRoles.some(role => role.roleName === Role.ROOT)) {
      return { mode: WalnutAdminConstDataScopeMode.ALL }
    }

    // 最宽优先：任一角色 ALL → ALL
    if (orderedActiveRoles.some(role => resolveSingleRoleDataScope(role).mode === WalnutAdminConstDataScopeMode.ALL)) {
      return { mode: WalnutAdminConstDataScopeMode.ALL }
    }

    const userIds = new Set<string>([input.userId])
    let hasCustom = false

    for (const role of orderedActiveRoles) {
      const single = resolveSingleRoleDataScope(role)

      if (single.mode === WalnutAdminConstDataScopeMode.CUSTOM) {
        hasCustom = true
        for (const memberId of input.customMemberIds?.[role.id] ?? []) {
          userIds.add(memberId)
        }
      }
    }

    if (hasCustom) {
      return {
        mode: WalnutAdminConstDataScopeMode.CUSTOM,
        userIds: uniqueIds([...userIds]),
      }
    }

    return { mode: WalnutAdminConstDataScopeMode.SELF }
  }

  // SWITCH（以及未知 roleMode 的保守分支）：只看 currentRole，失效回退首角色
  const currentRole = orderedActiveRoles.find(role => role.id === input.currentRoleId)
    ?? orderedActiveRoles[0]

  const single = resolveSingleRoleDataScope(currentRole)

  if (single.mode === WalnutAdminConstDataScopeMode.CUSTOM) {
    const userIds = uniqueIds([
      input.userId,
      ...(input.customMemberIds?.[currentRole.id] ?? []),
    ])

    return {
      mode: WalnutAdminConstDataScopeMode.CUSTOM,
      userIds: userIds.length > 0 ? userIds : [],
    }
  }

  return single
}
