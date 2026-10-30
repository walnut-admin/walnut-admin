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
import { SysRoleRepoService } from '../role/repo/role.repo.service'
import { SysUserRepositoryService } from '../user/repo/user.repo.service'
import { resolveWalnutDataScopeDescriptor } from './data-scope.resolver'

/**
 * 数据权限解析服务（docs/plans/data-scope-design.md §4 设计要点 1 / 6）。
 *
 * 职责：
 * 1. **解析**：按用户 junction 角色的实时值（user.role_mode / current_role_id +
 *    sys_user_role + sys_role.data_scope）产出描述符 —— 不信任 AT payload 的角色快照
 *    （P1-18 的同一个教训：角色移除后旧 AT 仍在有效期内）；
 * 2. **缓存**：`AUTH:DATA_SCOPE:<userId>`（不带 deviceId —— 角色不随设备变），
 *    TTL 与访问令牌同寿命（与 AUTH:PERMISSIONS 同口径）；
 * 3. **失效**：三个写入口 + 两个用户自助入口（见下），对照 AUTH:PERMISSIONS 的失效纪律。
 *
 * 失效点清单（改这些写路径时必须同步调本服务的 invalidate*）：
 * - 角色 dataScope / status 修改 → `invalidateForRole(roleId)`（role.service.update）
 * - 用户角色整组替换（sys_user_role 变更）→ `invalidateForUserRoleChanges(userId, 前后角色并集)`
 *   （user.crud.update）—— **必须按角色维度再失效一遍**：CUSTOM 的 userIds 是角色成员
 *   快照，成员变更会影响同角色其他成员的可见集；
 * - 用户删除（junction 级联）→ `invalidateForUserRoleChanges(userId, 删除前角色集)`
 *   （user.crud.delete）；
 * - 用户恢复（junction 快照回放）→ `invalidateForRecoveredUser(userId)`（deleted.service.recover*）；
 * - 用户切换当前角色 / 角色模式 → `invalidateForUser(userId)`（user.shared.switchRole/switchRoleMode）
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
      return { mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] }
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

    // root 恒 ALL：无需再查 CUSTOM 成员
    const hasRoot = roleSnapshots.some(role => role.status && role.roleName === Role.ROOT)

    const customMemberIds: Record<string, string[]> = {}
    if (!hasRoot) {
      for (const role of roleSnapshots) {
        if (role.status && role.dataScope === WalnutAdminConstDataScope.CUSTOM && role.roleName !== Role.VISITOR) {
          customMemberIds[role.id] = await this.roleRepoService.findUserIdsByRoleId(role.id, em)
        }
      }
    }

    const input: IWalnutAdminDataScopeResolveInput = {
      userId,
      roleMode: effectiveRoleMode,
      currentRoleId: user.currentRole,
      orderedRoleIds,
      roles: roleSnapshots,
      customMemberIds,
    }

    return resolveWalnutDataScopeDescriptor(input)
  }

  /**
   * 失效单个用户（用户角色变更 / 当前角色切换 / 角色模式切换 / 删除 / 恢复）
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
   * 查用户当前绑定的角色 id（调用方在**写之前**取旧集合，写后取新集合，两者并起来
   * 才是「受影响角色集」）。
   */
  async resolveRoleIdsForUser(userId: string, em?: EntityManager): Promise<string[]> {
    return this.roleRepoService.findRoleIdsByUserId(userId, em)
  }

  /**
   * 用户角色绑定变更：失效该用户 + **受影响角色的全部成员**。
   *
   * 为什么不能只失效用户自己（P1 复审）：CUSTOM 的 userIds 是「角色成员快照」——
   * B 被移出角色 R 后，R 的其他成员 C 的缓存里仍带着 B，C 会继续看到 B 的行，
   * 最长一个 AT TTL。角色成员集变了，所有成员的描述符都必须重算。
   *
   * @param userId 发生角色变更的用户
   * @param affectedRoleIds 变更前 ∪ 变更后的角色 id（由调用方收集）
   */
  async invalidateForUserRoleChanges(userId: string, affectedRoleIds: readonly string[]): Promise<void> {
    const uniqueRoleIds = [...new Set(affectedRoleIds)]

    // 只有 CUSTOM 角色的成员清单会随 membership 变化而改变（SELF/ALL 与成员无关；
    // root/visitor 是契约角色，列值不参与解析）。不按此过滤会让默认 visitor 角色
    // 的每次建号都去反查/清空全部游客缓存。
    const roles = uniqueRoleIds.length > 0
      ? await this.roleRepoService.findByIds(uniqueRoleIds)
      : []

    const customRoleIds = roles
      .filter(role => role.dataScope === WalnutAdminConstDataScope.CUSTOM
        && role.roleName !== Role.ROOT
        && role.roleName !== Role.VISITOR)
      .map(role => role.id)

    for (const roleId of customRoleIds) {
      await this.invalidateForRole(roleId)
    }

    await this.invalidateForUser(userId)
  }

  /**
   * 用户恢复（junction 快照回放）：按**恢复后**实际绑定的角色失效成员 + 用户本身。
   * 当前 user recoverer 不恢复 junction（DESIGN-ISSUES P2-18 残余），这里仍按实时
   * 绑定取集合 —— 未来 junction 恢复落地时无需再改本方法。
   */
  async invalidateForRecoveredUser(userId: string): Promise<void> {
    const roleIds = await this.resolveRoleIdsForUser(userId)
    await this.invalidateForUserRoleChanges(userId, roleIds)
  }
}
