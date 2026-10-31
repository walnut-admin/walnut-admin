import type { IWalnutAdminDataScopeDescriptor } from '@walnut-server/db'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Role } from '@walnut/contract'
import { toWalnutDataScopeMode } from './data-scope.predicates'

/**
 * 数据权限**解析器**（纯函数）—— 输入 = 用户 junction 角色快照 + 各角色 dataScope +
 * 已解析的部门维度（用户 dept、dept 子树、CUSTOM 部门清单），输出 = 描述符。
 * 决策层不碰 DB/缓存，可完整单测（docs/plans/data-scope-design.md §4 设计要点 1 /
 * §7「残余过滤条件接口」：未来接 OPA/策略引擎只换这一层）。
 *
 * 六档语义（docs/plans/data-scope-phase2-3-plan.md §1.1）：
 * - ALL：全量；
 * - CUSTOM：`sys_role_dept` 的部门清单（不递归子树；空清单默认拒绝）；
 * - DEPT：`[user.deptId]`（dept 为 NULL → 空集默认拒绝）；
 * - DEPT_AND_CHILD：用户部门 subtree（含自身；由服务层递归 CTE 预解析后传入）；
 * - SELF：本人；
 * - DEPT_OR_SELF：subtree ∪ 本人（描述符同时携带 deptIds 与 userIds）。
 *
 * 多角色语义（沿用 roleMode）：
 * - root 恒 ALL（COMBINE 下任一角色为 root；SWITCH 下 currentRole 为 root）；
 * - COMBINE：deptIds 取**并集**；任一 ALL → ALL；任一 SELF（含 DEPT_OR_SELF）→
 *   结果保留本人腿（DEPT_OR_SELF）；纯部门档位并集按 DEPT 描述（deptIds 已展开，
 *   执行层对 DEPT/DEPT_AND_CHILD/CUSTOM 是同一谓词）；
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
  /** `sys_role.data_scope` 原始 smallint（1..6） */
  dataScope: number
}

export interface IWalnutAdminDataScopeResolveInput {
  /** 当前用户（SELF 的本人；部门系档位并集的本人腿） */
  userId: string
  /** 用户所属部门（`sys_user.dept_id`；NULL = 无部门，DEPT 系档位默认拒绝） */
  userDeptId: string | null
  /**
   * 用户部门的**子树 id**（含自身，递归 CTE 预解析）。DEPT_AND_CHILD / DEPT_OR_SELF 用；
   * 缺省按空集（默认拒绝），service 在需要时才查库。
   */
  userDeptSubtreeIds?: string[]
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
  /** roleId → `sys_role_dept` 的 dept id 清单（只有 CUSTOM 角色需要；缺省按空集） */
  customDeptIds?: Record<string, string[]>
}

export const WALNUT_DATA_SCOPE_DENY: IWalnutAdminDataScopeDescriptor = {
  mode: WalnutAdminConstDataScopeMode.CUSTOM,
  deptIds: [],
}

function uniqueIds(ids: readonly (string | undefined)[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id !== ''))]
}

/** 单角色解析所需的部门上下文（全部由 service 预解析；缺省 = 无部门） */
export interface IWalnutAdminDataScopeSingleRoleContext {
  userId: string
  userDeptId: string | null
  userDeptSubtreeIds?: string[]
  customDeptIds?: string[]
}

/**
 * 角色行 → 该角色单独给出的 scope 面（不含多角色合并）：
 * root/visitor 两个契约角色优先于 data_scope 列。
 */
export function resolveSingleRoleDataScope(
  role: IWalnutAdminDataScopeRoleSnapshot,
  context?: Partial<IWalnutAdminDataScopeSingleRoleContext>,
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

  const userDeptId = context?.userDeptId ?? null
  const subtreeIds = uniqueIds(context?.userDeptSubtreeIds)

  switch (mode) {
    case WalnutAdminConstDataScopeMode.ALL:
      return { mode }

    case WalnutAdminConstDataScopeMode.SELF:
      return { mode }

    case WalnutAdminConstDataScopeMode.CUSTOM:
      // CUSTOM = sys_role_dept 部门清单（不递归子树）；空清单 → 默认拒绝
      return { mode, deptIds: uniqueIds(context?.customDeptIds) }

    case WalnutAdminConstDataScopeMode.DEPT:
      return { mode, deptIds: userDeptId === null ? [] : [userDeptId] }

    case WalnutAdminConstDataScopeMode.DEPT_AND_CHILD:
      // dept 为 NULL → 空集（subtree 由 service 预解析，缺省也不猜）
      return { mode, deptIds: userDeptId === null ? [] : subtreeIds }

    case WalnutAdminConstDataScopeMode.DEPT_OR_SELF:
      return {
        mode,
        deptIds: userDeptId === null ? [] : subtreeIds,
        userIds: uniqueIds([context?.userId]),
      }

    default:
      return WALNUT_DATA_SCOPE_DENY
  }
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

  const resolveSingle = (role: IWalnutAdminDataScopeRoleSnapshot) => resolveSingleRoleDataScope(role, {
    userId: input.userId,
    userDeptId: input.userDeptId,
    userDeptSubtreeIds: input.userDeptSubtreeIds,
    customDeptIds: input.customDeptIds?.[role.id] ?? [],
  })

  if (input.roleMode === WalnutAdminConstRoleMode.COMBINE) {
    // 任一 root → ALL（root 是超级角色，junction 里存在即全量）
    if (orderedActiveRoles.some(role => role.roleName === Role.ROOT)) {
      return { mode: WalnutAdminConstDataScopeMode.ALL }
    }

    // 最宽优先：任一角色 ALL → ALL
    if (orderedActiveRoles.some(role => resolveSingle(role).mode === WalnutAdminConstDataScopeMode.ALL)) {
      return { mode: WalnutAdminConstDataScopeMode.ALL }
    }

    const deptIds = new Set<string>()
    let hasSelfLeg = false

    for (const role of orderedActiveRoles) {
      const single = resolveSingle(role)

      if (single.mode === WalnutAdminConstDataScopeMode.SELF) {
        hasSelfLeg = true
        continue
      }

      if (single.mode === WalnutAdminConstDataScopeMode.DEPT_OR_SELF) {
        hasSelfLeg = true
      }

      for (const deptId of single.deptIds ?? []) {
        deptIds.add(deptId)
      }
    }

    if (deptIds.size === 0) {
      // 没有任何部门面：要么是 SELF，要么是全员空集（CUSTOM 空清单 / 无部门）
      return hasSelfLeg
        ? { mode: WalnutAdminConstDataScopeMode.SELF }
        : { ...WALNUT_DATA_SCOPE_DENY, deptIds: [] }
    }

    if (hasSelfLeg) {
      return {
        mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
        deptIds: [...deptIds],
        userIds: [input.userId],
      }
    }

    // 纯部门档位并集：deptIds 已展开，来源档位不再影响执行谓词
    return { mode: WalnutAdminConstDataScopeMode.DEPT, deptIds: [...deptIds] }
  }

  // SWITCH（以及未知 roleMode 的保守分支）：只看 currentRole，失效回退首角色
  const currentRole = orderedActiveRoles.find(role => role.id === input.currentRoleId)
    ?? orderedActiveRoles[0]

  return resolveSingle(currentRole)
}
