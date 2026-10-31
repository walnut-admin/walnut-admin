import type { IWalnutAdminDataScopeDescriptor } from '@walnut-server/db'
import type { EntityManager } from 'typeorm'
import type { IWalnutAdminDataScopeResolveInput, IWalnutAdminDataScopeRoleSnapshot } from './data-scope.resolver'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheAppSettingsService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { Role } from '@walnut/contract'
import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { SysDeptBasicRepository } from '../dept/dept.basic.repository'
import { SysRoleRepoService } from '../role/repo/role.repo.service'
import { SysUserRepositoryService } from '../user/repo/user.repo.service'
import { resolveWalnutDataScopeDescriptor } from './data-scope.resolver'

/**
 * `app.functional.role` 是 effective roleMode 的来源（GLOBAL 取 globalValue / LOCAL 取
 * user.roleMode）。写设置时用本判定决定是否 bump 数据权限 epoch；create/update 与
 * `updateAppSettingByKey` 两条写通道共用，避免只按「新 key」判定漏掉改名离开的场景。
 */
export function isWalnutDataScopeSettingKey(settingKey: string | null | undefined): boolean {
  return settingKey === WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_ROLE
}

/**
 * 数据权限解析服务（docs/plans/data-scope-design.md §4 设计要点 1 / 6；
 * 部门维度见 docs/plans/data-scope-phase2-3-plan.md §1.1）。
 *
 * 职责：
 * 1. **解析**：按用户 junction 角色的实时值（user.role_mode / current_role_id /
 *    user.dept_id + sys_user_role + sys_role.data_scope + sys_role_dept）产出描述符 ——
 *    不信任 AT payload 的角色快照（P1-18 的同一个教训：角色移除后旧 AT 仍在有效期内）；
 *    部门子树（DEPT_AND_CHILD / DEPT_OR_SELF）在需要时经递归 CTE 预解析；
 * 2. **缓存**：`AUTH:DATA_SCOPE:<epoch>:<userId>`（不带 deviceId —— 角色不随设备变；
 *    epoch 是全局世代，见 `bumpEpoch`），TTL 与访问令牌同寿命（与 AUTH:PERMISSIONS
 *    同口径）；`AUTH:DATA_SCOPE:dept:<userId>`（账号部门，RLS WITH CHECK 用）不参与世代。
 * 3. **失效**：写入口清单见下。
 *
 * 失效点清单（改这些写路径时必须同步调本服务的 invalidate*）：
 * - 角色 dataScope / status 修改 → `invalidateForRole(roleId)`（role.service.update）；
 * - `sys_role_dept`（CUSTOM 部门清单）变更 → 影响的是**该角色成员**（他们的描述符
 *   里带着这份清单）。批 2 的写入口是角色 update 的 `deptIds` 整组替换 ——
 *   role.service 已在同一成员反查腿上并入 `invalidateForUsers`；`invalidateForRoleDeptChange`
 *   保留给未来独立的部门清单写端点；
 * - 部门移动 / 删除 → `invalidateForDeptMove(deptId, oldAncestorIds)` /
 *   `invalidateForDeptIds(deptIds)` —— 移动影响旧/新祖先链与子树内用户，
 *   删除影响子树内用户（dept.service update/delete）；
 * - 用户角色整组替换 → `invalidateForUser(userId)`（user.crud.update）；
 * - 用户部门变更 → `invalidateForUser(userId)`（user.crud.update 的 deptId 分支）；
 * - 用户删除（junction 级联）/ 恢复 / 切换当前角色 / 角色模式 → `invalidateForUser`
 *   （user.crud.delete / deleted.service.recover* / user.shared.switchRole*）；
 * - `app.functional.role` 设置变更（effective roleMode 来源）→ `bumpEpoch()`
 *   （setting.service create/update，批 4 / L2，DESIGN-ISSUES P3-36）：全局世代 +1，
 *   所有用户的旧描述符键自然孤儿化。
 *
 * 世代语义（重要）：上面的 `invalidate*` 删的都是**当前 epoch** 的键；`bumpEpoch()`
 * 之后旧世代的键不再被读取，交给 TTL 自然回收（不做 SCAN 全量删除 —— 扫描成本与
 * 原子性都差）。因此失效点清单同时包含「精确失效」与「全局世代」两类通道。
 *
 * 二期语义演进（重要）：CUSTOM 从「角色成员 userIds 快照」改为「部门清单」后，
 * **角色成员变化不再影响同角色其他成员**（清单与成员无关）；原先为此设计的
 * `invalidateForUserRoleChanges` / `invalidateForRecoveredUser` 已删除。
 * 角色删除端点当前不存在（role controller 只有 create/read/update/list）；未来新增删除
 * 通道时必须先按 roleId 反查成员再 `invalidateForUsers`，否则被删角色的描述符会驻留
 * 到 TTL 到期。
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

  /**
   * 全局缓存世代（批 4 / L2，P3-36）。键落在 `WALNUT_CACHE_` 命名空间**之外**：
   * 它必须是裸整数（INCR 语义），且不能被监控台的 clear / 按 key 删除重置为 0 ——
   * 否则尚未过期的旧 epoch 描述符会复活。读路径 GET 不到按 0（不写）。
   */
  private getEpochCacheKey(): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_DATA_SCOPE}:EPOCH`
  }

  /**
   * 读全局世代；Redis 异常返回 null。null 表示**跳过描述符缓存**（调用方直接重算，
   * 不读也不写）—— 不能回落 0：epoch 0 的旧键可能仍在 TTL 内，回落会把旧世代描述符
   * 当成当前值。
   */
  private async tryGetEpoch(): Promise<number | null> {
    try {
      const raw = await this.cacheService.redis.get(this.getEpochCacheKey())
      const epoch = raw === null ? 0 : Number.parseInt(raw, 10)
      return Number.isFinite(epoch) && epoch >= 0 ? epoch : 0
    }
    catch (error) {
      this.logger.warn('read data scope epoch failed, bypassing descriptor cache for this resolution', error)
      return null
    }
  }

  private buildCacheKey(epoch: number, userId: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_DATA_SCOPE}:${epoch}:${userId}`
  }

  /**
   * 全局失效入口：epoch + 1（INCR，O(1) 且天然并发安全）。
   * 旧世代的描述符键自然孤儿化，由 TTL 回收 —— 不做 SCAN 全量删除。
   *
   * 失败只 warn 不向上抛：失效动作失败不应让设置写返回 500；代价是旧描述符残留
   * 最长一个 AT TTL（下一次 bump 会一并孤儿化）。
   *
   * **单实例边界**：本方案依赖进程内 APP:SETTING memo 在写时同步清理（见
   * `cache.appSettings.ts` 的一致性说明）—— 多实例部署下其他实例的 memo 不会随
   * epoch bump 失效，扩多实例前需另行评估（与 P2-27 同一前置条件）。
   */
  async bumpEpoch(): Promise<void> {
    try {
      await this.cacheService.redis.incr(this.getEpochCacheKey())
    }
    catch (error) {
      this.logger.warn('bump data scope epoch failed; stale descriptors may persist until TTL', error)
    }
  }

  /** 账号自己的部门（仅 RLS 的 sys_user / sys_employee WITH CHECK 使用） */
  private getUserDeptCacheKey(userId: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_DATA_SCOPE}:dept:${userId}`
  }

  /**
   * 解析当前用户账号的部门（`sys_user.dept_id`），缓存口径与描述符一致。
   *
   * 为什么单独一条腿：描述符是「可见明细」（SELF 不携带 deptIds），而 RLS 的
   * sys_user / sys_employee WITH CHECK 需要知道「本人当前部门」才能区分
   * 「自助更新但没改部门」与「把 dept_id 改到天花板外」。空值缓存成空串（区分
   * 「无部门」与缓存 miss）。
   */
  async resolveUserDeptId(userId: string, em?: EntityManager): Promise<string | null> {
    const cached = await this.cacheService.get<string>(this.getUserDeptCacheKey(userId))

    if (cached !== null && cached !== undefined) {
      return cached === '' ? null : cached
    }

    const user = await this.userRepoService.findUserByUserId(userId, em)
    const deptId = user?.deptId ?? null

    try {
      await this.cacheService.set(
        this.getUserDeptCacheKey(userId),
        deptId ?? '',
        {
          ttl: this.tokenService.getAccessTokenExpireSeconds(),
          t: WalnutAdminConstAppCacheType.AUTH,
        },
      )
    }
    catch (error) {
      this.logger.warn(`write data scope user dept cache failed for user ${userId}`, error)
    }

    return deptId
  }

  /**
   * 解析某用户的数据权限描述符（缓存优先）。
   *
   * 无用户 / 无启用角色 → 默认拒绝（CUSTOM 空集）。缓存正负结果都写
   * （避免无角色用户每请求都打库）。
   */
  async resolveForUser(userId: string, em?: EntityManager): Promise<IWalnutAdminDataScopeDescriptor> {
    const epoch = await this.tryGetEpoch()

    // epoch 不可读 → 跳过描述符缓存（不读不写）：宁可每次重算，也不把可能过期的
    // 旧世代键当成当前值。
    if (epoch === null) {
      return this.computeForUser(userId, em)
    }

    const cacheKey = this.buildCacheKey(epoch, userId)
    const cached = await this.cacheService.get<IWalnutAdminDataScopeDescriptor>(cacheKey)

    if (cached !== null && cached !== undefined) {
      return cached
    }

    const descriptor = await this.computeForUser(userId, em)

    try {
      await this.cacheService.set(
        cacheKey,
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
    await this.invalidateForUsers([userId])
  }

  /**
   * 批量失效：epoch 只读一次（N 个用户不做 N 次 Redis 往返）。
   * 只删当前世代的键；bumpEpoch 之后的旧键已不可达，等 TTL 回收。
   * epoch 不可读时仍清账号部门键（描述符键已无法定位，交给 TTL）。
   */
  async invalidateForUsers(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)]
    if (ids.length === 0) {
      return
    }

    const epoch = await this.tryGetEpoch()
    const keys = ids.flatMap(userId => [
      ...(epoch === null ? [] : [this.buildCacheKey(epoch, userId)]),
      this.getUserDeptCacheKey(userId),
    ])

    await Promise.all(keys.map(async (key): Promise<unknown> => this.cacheService.del(key)))
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
   * （角色 update 的 deptIds 整组替换已并入现有成员反查腿；本方法供独立写端点复用。）
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
