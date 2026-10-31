import type { SysRoleEntity } from './entity/role.entity'

/**
 * 批 7 / L7（P3-35 收口）：role:update 的**授权敏感面**审计快照。
 *
 * 维护者口径（remediation-plan §5.2）：不拦截 dataScope 修改，只让「谁在什么时候把
 * 角色范围从什么改成什么」可审计。这里只取四个授权面 —— dataScope / status /
 * deptIds / menus，不做全字段 diff；角色行的其余字段由基类 update 的既有行快照承载。
 *
 * 角色行的 dataScope/status 在 `sys_role` 行上，基类快照天然带；menus / deptIds 落在
 * junction（`sys_role_menu` / `sys_role_dept`），基类取不到 —— 本函数把它们组装成
 * 可并进 `sys_log_operate.snapshot_before / snapshot_after` 的形态。
 *
 * 数组按字典序排序：junction 读出的顺序由 DB 决定（无 ORDER BY），排序保证同一清单在
 * 日志里可比、不因物理顺序产生假 diff；UUID 统一小写（PG uuid 列入库即小写，客户端
 * 大写变体不再产生假 diff）。完整数组不截断 —— deptIds 已由 DTO 限制 200 条，menus
 * 当前受 sys_menu 规模约束（约 172 条）体积可控；截断会让被截部分不可见，与审计目标冲突。
 */
export interface IRoleAuthorizationAuditSnapshot {
  dataScope: number
  status: boolean
  deptIds: string[]
  menus: string[]
}

/** PG uuid 列统一小写；客户端大写变体归一后再比较/入快照 */
function normalizeUuidList(ids: readonly string[]): string[] {
  return [...ids].map(id => id.toLowerCase()).sort()
}

export function buildRoleAuthorizationAuditSnapshot(
  role: Pick<SysRoleEntity, 'dataScope' | 'status'>,
  deptIds: readonly string[],
  menus: readonly string[],
): IRoleAuthorizationAuditSnapshot {
  return {
    dataScope: role.dataScope,
    status: role.status,
    deptIds: normalizeUuidList(deptIds),
    menus: normalizeUuidList(menus),
  }
}

/**
 * after 侧组装：dto 显式给了数组才视为整组替换（与 `SysRoleBasicRepository.update`
 * 的「未给不动 / 给了整组替换」语义一致）；角色行两列取 update 后的新值。
 */
export function buildRoleAuthorizationAuditAfter(
  role: Pick<SysRoleEntity, 'dataScope' | 'status'>,
  before: IRoleAuthorizationAuditSnapshot,
  dto: { deptIds?: string[], menus?: string[] },
): IRoleAuthorizationAuditSnapshot {
  return buildRoleAuthorizationAuditSnapshot(
    role,
    dto.deptIds ?? before.deptIds,
    dto.menus ?? before.menus,
  )
}
