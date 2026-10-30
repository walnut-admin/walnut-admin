import type { EntityManager } from 'typeorm'
import type { IWalnutAdminDataScopeResolveInput, IWalnutAdminDataScopeRoleSnapshot } from './data-scope.resolver'
import type { IWalnutAdminDataScopeDescriptor } from '@/common/repository/data-scope'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { Role } from '@walnut/contract'
import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { SysDeptBasicRepository } from '../dept/dept.basic.repository'
import { SysRoleRepoService } from '../role/repo/role.repo.service'
import { SysUserRepositoryService } from '../user/repo/user.repo.service'
import { resolveWalnutDataScopeDescriptor } from './data-scope.resolver'

/**
 * 数据权限解析服务（docs/plans/data-scope-design.md §4 设计要点 1 / 6；
 * 部门维度见 docs/plans/data-scope-phase2-3-plan.md §1.1）。
 *
 * 职责：
 * 1. **解析**：按用户 junction 角色的实时值（user.role_mode / current_role_id /
 *    user.dept_id + sys_user_role + sys_role.data_scope + sys_role_dept）产出描述符 ——
 *    不信任 AT payload 的角色快照（P1-18 的同一个教训：角色移除后旧 AT 仍在有效期内）；
 *    部门子树（DEPT_AND_CHILD / DEPT_OR_SELF）在需要时经递归 CTE 预解析；
 * 2. **缓存**：`AUTH:DATA_SCOPE:<userId>`（不带 deviceId —— 角色不随设备变），
 *    TTL 与访问令牌同寿命（与 AUTH:PERMISSIONS 同口径）；
 * 3. **失效**：写入口清单见下。
 *
 * 失效点清单（改这些写路径时必须同步调本服务的 invalidate*）：
 * - 角色 dataScope / status 修改 → `invalidateForRole(roleId)`（role.service.update）；
 * - `sys_role_dept`（CUSTOM 部门清单）变更 → `invalidateForRoleDeptChange(roleId)`
 *   —— 影响的是**该角色成员**（他们的描述符里带着这份清单）；批 1 无写端点，
 *   批 2 的角色部门树保存路径接线；
 * - 部门移动 / 删除 → `invalidateForDeptMove(deptId, oldAncestorIds)` /
 *   `invalidateForDeptIds(deptIds)` —— 移动影响旧/新祖先链与子树内用户，
 *   删除影响子树内用户（dept.service update/delete）；
 * - 用户角色整组替换 → `invalidateForUser(userId)`（user.crud.update）；
 * - 用户部门变更 → `invalidateForUser(userId)`（user.crud.update 的 deptId 分支）；
 * - 用户删除（junction 级联）/ 恢复 / 切换当前角色 / 角色模式 → `invalidateForUser`
 *   （user.crud.delete / deleted.service.recover* / user.shared.switchRole*）。
 *
 * 二期语义演进（重要）：CUSTOM 从「角色成员 userIds 快照」改为「部门清单」后，
 * **角色成员变化不再影响同角色其他成员**（清单与成员无关）；原先为此设计的
 * `invalidateForUserRoleChanges` / `invalidateForRecoveredUser` 已删除。
 * 角色删除端点当前不存在（role controller 只有 create/read/update/list）；未来新增删除
 * 通道时必须先按 roleId 反查成员再 `invalidateForUsers`，否则被删角色的描述符会驻留
 * 到 TTL 到期。
 * 已知残余面（DESIGN-ISSUES P3-36）：`app.functional.role`（effective roleMode 来源）
 * 变更不失效本缓存，残留最长一个 AT TTL —— 改 setting 的写路径目前不感知本服务。
 */
@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly scopeResolverService: SharedScopeResolverService,
    private readonly tokenService: AppTokenService,
    private readonly userRepoService: SysUserRepositoryService,
    private readonly roleRepoService: SysRoleRepoService,
    private readonly deptBasicRepo: SysDeptBasicRepository,
  ) {}

  private getCacheKey(userId: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_DATA_SCOPE}:${userId}`
  }

  /**
   * 解析某用户的数据权限描述符（缓存优先）。
   *
   * 无用户 / 无启用角色 → 默认拒绝（CUSTOM 空集）。缓存正负结果都写
   * （避免无角色用户每请求都打库）。
   */
  async resolveForUser(userId: string, em?: EntityManager): Promise<IWalnutAdminDataScopeDescriptor> {
    const cached = await this.cacheService.get<IWalnutAdminDataScopeDescriptor>(this.getCacheKey(userId))

    if (cached !== null && cached !== undefined) {
      return cached
    }

    const descriptor = await this.computeForUser(userId, em)

    try {
      await this.cacheService.set(
        this.getCacheKey(userId),
        descriptor,
        {
          ttl: this.tokenService.getAccessTokenExpireSeconds(),
          t: WalnutAdminConstAppCacheType.AUTH,
        },
      )
    }
    catch (error) {
      // 缓存失败不影响本次判定；下一次请求重算（Redis 故障时数据权限仍然正确）
      this.logger.warn(`write data scope cache failed for user ${userId}`, error)
    }

    return descriptor
  }

  /** 绕过缓存重算（测试/失效后立即重算用） */
  async computeForUser(userId: string, em?: EntityManager): Promise<IWalnutAdminDataScopeDescriptor> {
    const user = await this.userRepoService.findUserByUserId(userId, em)

    if (user === null || user === undefined) {
      return { mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] }
    }

    const orderedRoleIds = await this.roleRepoService.findRoleIdsByUserId(userId, em)
    const roles = orderedRoleIds.length > 0
      ? await this.roleRepoService.findByIds(orderedRoleIds, em)
      : []

    const roleSnapshots: IWalnutAdminDataScopeRoleSnapshot[] = roles.map(role => ({
      id: role.id,
      roleName: role.roleName,
      status: role.status,
      dataScope: role.dataScope,
    }))

    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()
    const effectiveRoleMode = this.scopeResolverService.resolve(functionalRole, {
      roleMode: user.roleMode,
    })

    // root 恒 ALL：无需再查 CUSTOM 部门清单 / 部门子树
    const hasRoot = roleSnapshots.some(role => role.status && role.roleName === Role.ROOT)

    const activeDeptRoles = roleSnapshots.filter(role => role.status
      && role.roleName !== Role.ROOT
      && role.roleName !== Role.VISITOR)

    const userDeptId = user.deptId ?? null

    // 子树只在 DEPT_AND_CHILD / DEPT_OR_SELF 出现且用户有部门时查询（一次 CTE 覆盖全部角色）
    const needsSubtree = userDeptId !== null && !hasRoot && activeDeptRoles.some(role =>
      role.dataScope === WalnutAdminConstDataScope.DEPT_AND_CHILD
      || role.dataScope === WalnutAdminConstDataScope.DEPT_OR_SELF)

    const userDeptSubtreeIds = needsSubtree
      ? await this.deptBasicRepo.findDeptIdsInSubtree(userDeptId, em)
      : []

    const customDeptIds: Record<string, string[]> = {}
    if (!hasRoot) {
      for (const role of activeDeptRoles) {
        if (role.dataScope === WalnutAdminConstDataScope.CUSTOM) {
          customDeptIds[role.id] = await this.roleRepoService.findDeptIdsByRoleId(role.id, em)
        }
      }
    }

    const input: IWalnutAdminDataScopeResolveInput = {
      userId,
      userDeptId,
      userDeptSubtreeIds,
      roleMode: effectiveRoleMode,
      currentRoleId: user.currentRole,
      orderedRoleIds,
      roles: roleSnapshots,
      customDeptIds,
    }

    return resolveWalnutDataScopeDescriptor(input)
  }

  /**
   * 失效单个用户（用户角色变更 / 部门变更 / 当前角色切换 / 角色模式切换 / 删除 / 恢复）
   */
  async invalidateForUser(userId: string): Promise<void> {
    await this.cacheService.del(this.getCacheKey(userId))
  }

  async invalidateForUsers(userIds: string[]): Promise<void> {
    await Promise.all([...new Set(userIds)].map(async userId => this.invalidateForUser(userId)))
  }

  /**
   * 失效某角色的全部成员（角色 dataScope / status 修改）
   *
   * 与 AUTH:PERMISSIONS 的 `delPermissionsForUser` 同一反查腿：sys_user_role 按
   * role_id 点查，角色成员量级小。
   */
  async invalidateForRole(roleId: string, em?: EntityManager): Promise<void> {
    const userIds = await this.roleRepoService.findUserIdsByRoleId(roleId, em)
    await this.invalidateForUsers(userIds)
  }

  /**
   * `sys_role_dept` 变更：该角色成员的 CUSTOM 部门清单变了，按角色维度失效。
   * （批 2 的角色部门树保存路径调用；当前无写端点。）
   */
  async invalidateForRoleDeptChange(roleId: string, em?: EntityManager): Promise<void> {
    await this.invalidateForRole(roleId, em)
  }

  /**
   * 部门移动（parent 变更）后的失效。
   *
   * 只失效「被移动子树内的用户」是不够的：移动不改变子树内用户自己的 subtree，
   * 真正变化的是**祖先链**用户的 DEPT_AND_CHILD（旧祖先失去该子树、新祖先获得）。
   * 因此这里失效三组：被移动子树 + 新祖先链 + 调用方捕获的旧祖先链。
   *
   * @param deptId 被移动的部门
   * @param oldAncestorDeptIds 移动**前**的祖先链（服务层在 update 前取好；缺省视为无）
   * @param em 可选事务句柄（只读查询用）
   */
  async invalidateForDeptMove(
    deptId: string,
    oldAncestorDeptIds: readonly string[] = [],
    em?: EntityManager,
  ): Promise<void> {
    const [subtreeIds, ancestorIds] = await Promise.all([
      this.deptBasicRepo.findDeptIdsInSubtree(deptId, em),
      this.deptBasicRepo.findAncestorDeptIds(deptId, em),
    ])

    await this.invalidateForDeptIds([...subtreeIds, ...ancestorIds, ...oldAncestorDeptIds], em)
  }

  /**
   * 部门删除：调用方在**删除前**取子树 id，事务提交后用本方法失效子树内用户。
   * （删除后 CTE 已查不到该子树，所以不能复用 invalidateForDeptMove。）
   */
  async invalidateForDeptIds(deptIds: readonly string[], em?: EntityManager): Promise<void> {
    const ids = [...new Set(deptIds.filter(id => typeof id === 'string' && id !== ''))]
    if (ids.length === 0) {
      return
    }

    const userIds = await this.userRepoService.findUserIdsByDeptIds(ids, em)
    await this.invalidateForUsers(userIds)
  }
}
