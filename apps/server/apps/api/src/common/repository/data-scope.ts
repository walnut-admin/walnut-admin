import type { EntityTarget, FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { Role } from '@walnut/contract'
import { In, IsNull } from 'typeorm'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { AppErrorEntity } from '@/modules/app/error/entity/error.entity'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { AppMonitorUserEntity } from '@/modules/app/monitor/user/entity/monitor-user.entity'
import { AppSettingEntity } from '@/modules/app/setting/entity/setting.entity'
import { AuthRefreshTokenEntity } from '@/modules/auth/modules/refresh/entity/refresh-token.entity'
import { SharedAreaEntity } from '@/modules/shared/area/entity/area.entity'
import { SysDeletedEntity } from '@/modules/system/deleted/entity/deleted.entity'
import { SysDeptEntity } from '@/modules/system/dept/entity/dept.entity'
import { SysDeviceEntity } from '@/modules/system/device/entity/device.entity'
import { SysDictDataEntity } from '@/modules/system/dict/dictData/entity/dict-data.entity'
import { SysDictTypeEntity } from '@/modules/system/dict/dictType/entity/dict-type.entity'
import { SysEmployeeEntity } from '@/modules/system/employee/entity/employee.entity'
import { SysLangEntity } from '@/modules/system/lang/entity/lang.entity'
import { SysLocaleEntity } from '@/modules/system/locale/entity/locale.entity'
import { SysLogAuthEntity } from '@/modules/system/logs/auth/entity/log-auth.entity'
import { SysLogOperateEntity } from '@/modules/system/logs/operate/entity/log-operate.entity'
import { SysMenuEntity } from '@/modules/system/menu/entity/menu.entity'
import { SysPostEntity } from '@/modules/system/post/entity/post.entity'
import { SysRoleMenuEntity } from '@/modules/system/role/entity/role-menu.entity'
import { SysRoleEntity } from '@/modules/system/role/entity/role.entity'
import { SysUserRoleEntity } from '@/modules/system/user/entity/user-role.entity'
import { SysUserEntity } from '@/modules/system/user/entity/user.entity'
import { SysUserDeviceEntity } from '@/modules/system/user_device/entity/user-device.entity'
import { SysUserIdentityEntity } from '@/modules/system/user_identity/entity/user-identity.entity'
import { SysUserLockEntity } from '@/modules/system/user_lock/entity/user-lock.entity'
import { SysUserMfaEntity } from '@/modules/system/user_mfa/entity/user-mfa.entity'
import { SysUserOauthEntity } from '@/modules/system/user_oauth/entity/user-oauth.entity'
import { SysUserPreferenceEntity } from '@/modules/system/user_preference/entity/user-preference.entity'

/**
 * 数据权限一期的**实体注册表**与谓词构造 —— 纯数据 + 纯函数，零 Nest/DB 依赖，
 * 可直接单测（docs/plans/data-scope-design.md §4，§7「残余过滤条件接口」）。
 *
 * 语义边界（重要）：
 * - **注册 = 强制过滤**：一经注册，`WalnutAdminCommonPgBaseRepository` 的
 *   list / readById / updateByField / delete* / create 全部按 owner 列注入 scope；
 * - **未注册 = 显式豁免**：全局共享表 / 安全面系统表不注册（逐条理由见
 *   `WALNUT_DATA_SCOPE_EXEMPT_ENTITIES`），查询不受数据权限影响；
 * - 机械守卫：`data-scope.spec.ts` 断言「所有含 owner 列的实体都已注册或登记豁免」
 *   「注册的 scopeColumn 都是实体真实列」。
 *
 * owner 列语义（一期三档）：
 * - ALL：不注入谓词；
 * - SELF：`scopeColumn = 当前 userId`；
 * - CUSTOM：`scopeColumn IN (:...userIds)`；空集 → `1 = 0`（默认拒绝）。
 * `allowAnonymous` 的实体（在线监控）在 SELF/CUSTOM 下并上 `scopeColumn IS NULL`：
 * 未登录访客没有 owner，归为共享匿名行。
 */

export type IWalnutAdminDataScopeMode = typeof WalnutAdminConstDataScopeMode[keyof typeof WalnutAdminConstDataScopeMode]

/**
 * 解析后的数据权限描述符（一期）。`userIds` 只在 CUSTOM 下有意义。
 * SELF 的「本人」由 ALS 的 userId 提供（描述符本身不重复携带，缓存按 userId 键）。
 */
export interface IWalnutAdminDataScopeDescriptor {
  mode: IWalnutAdminDataScopeMode
  userIds?: string[]
}

export interface IWalnutAdminDataScopeEntityConfig<Entity extends ObjectLiteral = ObjectLiteral> {
  /** TypeORM 实体类（与基类 `entityTarget` 同一引用） */
  entity: EntityTarget<Entity>
  /**
   * owner 列（**实体属性名**，不是数据库列名）—— QueryBuilder 与 FindOptions
   * 都用属性名，TypeORM 负责列名映射。
   */
  scopeColumn: keyof Entity & string
  /** SELF/CUSTOM 下是否把 owner 为 NULL 的行视为共享（在线监控的匿名访客行） */
  allowAnonymous?: boolean
  /**
   * create 时是否用当前用户回填 owner 列（默认 true）。两种例外：
   * - 主键即 owner（sys_user.id）：不能回填；
   * - user_id 是**业务绑定**而非创建者（sys_employee）：回填会撞 uq_employee_user。
   */
  fillOwnerOnCreate?: boolean
  /**
   * update / updateByField 是否允许写 owner 列（默认 false = 一律剔除）。
   *
   * 唯一例外是 `sys_employee.user_id`：它是「职工 ↔ 账号」的业务绑定（由 bind-user /
   * unbind-user 端点受控修改），不是创建者；其余注册实体的 owner 列只允许 create
   * 时由当前用户回填。
   */
  allowOwnerUpdate?: boolean
  /** 注册理由（必填：注册即强制过滤，理由要能被下一个人看懂） */
  note: string
}

/**
 * 一期注册清单（带 owner 语义的业务表）。
 *
 * 为什么只有这些：数据权限的目标是「业务数据行」，一期先把**有明确归属**的表纳入；
 * 全局共享表与登录/安全面系统表不注册（见豁免清单）。部门/岗位等组织维度二期再做。
 */
export const WALNUT_DATA_SCOPE_ENTITIES: ReadonlyArray<IWalnutAdminDataScopeEntityConfig> = [
  {
    entity: SysUserEntity,
    scopeColumn: 'id',
    fillOwnerOnCreate: false,
    note: 'sys_user：SELF = 本人账号行（id 即 owner）；CUSTOM = 显式用户 id 集合。create 不回填主键。',
  },
  {
    entity: SysLogOperateEntity,
    scopeColumn: 'userId',
    note: 'sys_log_operate：操作日志按操作者过滤。写路径走 repo service 旁路写（不经基类），读路径由基类注入。',
  },
  {
    entity: SysLogAuthEntity,
    scopeColumn: 'userId',
    note: 'sys_log_auth：登录日志按登录用户过滤；失败登录 user_id 为 NULL，非 root 不可见（审计面收敛）。',
  },
  {
    entity: AppMonitorUserEntity,
    scopeColumn: 'userId',
    allowAnonymous: true,
    note: 'app_monitor_user：在线监控。未登录访客 user_id 为 NULL —— 匿名行对浏览者共享（allowAnonymous）。',
  },
  {
    entity: SysDeletedEntity,
    scopeColumn: 'deletedBy',
    note: 'sys_deleted：回收站快照按删除者过滤；recoverMine 另有 deletedBy === 当前用户 的属主校验。',
  },
  {
    entity: AppDemoEntity,
    scopeColumn: 'createdBy',
    note: 'app_demo：示范 owner 列（migration 新增 created_by）；create 自动填当前用户。',
  },
  {
    entity: SysEmployeeEntity,
    scopeColumn: 'userId',
    fillOwnerOnCreate: false,
    allowOwnerUpdate: true,
    note: 'sys_employee：人事记录挂账号（uq_employee_user 一号一职工）。user_id 是绑定语义不是创建者，create 不回填；update 允许改（仅 bind-user/unbind-user 入口）。',
  },
]

export interface IWalnutAdminDataScopeExemptEntity {
  entity: EntityTarget<ObjectLiteral>
  reason: string
}

/**
 * 显式豁免清单 —— **未注册即豁免**，这里把「为什么」逐条钉住，防止漏注册被当成
 * 忘记注册。机械守卫会把「含 owner 列的实体」与 注册 ∪ 豁免 两边对账。
 *
 * 判据：一期 scope 只覆盖业务数据行；以下三类不在一期范围：
 * ① 全局共享/配置表（所有登录用户看到同一份）；
 * ② 登录/安全/会话系统表（guard 链与 auth 链路先于 ALS 拦截器执行，纳入 scope 会断登录）；
 * ③ 组织维度表（部门/岗位/职工的组织面，随二期部门维度一起设计；职工主表本身已注册）。
 */
export const WALNUT_DATA_SCOPE_EXEMPT_ENTITIES: ReadonlyArray<IWalnutAdminDataScopeExemptEntity> = [
  // ── ① 全局共享 / 配置表 ──────────────────────────────────────────────────
  { entity: SysRoleEntity, reason: '角色定义是全局共享配置（谁能看哪些角色不是行级数据）；角色本身的维护靠功能权限' },
  { entity: SysMenuEntity, reason: '菜单/权限点是全局共享配置；角色授权经 sys_role_menu' },
  { entity: SysDictTypeEntity, reason: '字典类型是全局共享配置' },
  { entity: SysDictDataEntity, reason: '字典数据是全局共享配置' },
  { entity: SysLangEntity, reason: '语言清单是全局共享配置' },
  { entity: SysLocaleEntity, reason: '语言包是全局共享配置（前端所有用户同一份）' },
  { entity: SharedAreaEntity, reason: '行政区划是全局共享参考数据（66 万行，无归属）' },
  { entity: AppSettingEntity, reason: '应用设置是全局配置（含 created_by 但语义是变更记录，不是数据归属）' },
  { entity: AppKeyEntity, reason: '密钥材料是系统级配置（current/rotate 由守卫与内部任务消费）' },
  { entity: AppErrorEntity, reason: '错误监控是系统旁路采集（user_id 只是现场快照），排障需要跨用户读' },
  { entity: AuthRefreshTokenEntity, reason: '登录会话表：auth 链路（refresh/revoke/purge）在请求上下文之外读写，纳入 scope 会断登录' },
  // ── ② 登录/安全面系统表 ───────────────────────────────────────────────────
  { entity: SysUserDeviceEntity, reason: '用户-设备绑定是安全面数据（device/lock/signout 链路按 userId+deviceId 点查），一期不纳入行级 scope' },
  { entity: SysUserIdentityEntity, reason: '登录凭据（口令/手机/邮箱）属于安全面：只按 userId 点查，纳入列表 scope 无收益且有断登录风险' },
  { entity: SysUserLockEntity, reason: '锁屏偏好属于安全面：按 userId+deviceId 点查' },
  { entity: SysUserMfaEntity, reason: 'MFA 凭据属于安全面：按 userId 点查（含密文列）' },
  { entity: SysUserOauthEntity, reason: 'OAuth 绑定属于安全面：按 provider+providerId / userId 点查' },
  { entity: SysUserPreferenceEntity, reason: '用户偏好属于自服务面：按 userId 点查' },
  { entity: SysDeviceEntity, reason: 'sys_device 无 user_id 列（设备归属在 sys_user_device 关联表）；一期登记豁免，二期与设备维度一起设计' },
  // ── ③ 组织维度（二期部门维度一起做）──────────────────────────────────────
  { entity: SysDeptEntity, reason: '部门树是组织维度，二期数据权限（DEPT/DEPT_AND_CHILD）统一设计' },
  { entity: SysPostEntity, reason: '岗位是组织维度（平表），二期与部门维度一起设计' },
  // ── junction（随主行 CASCADE 生灭）────────────────────────────────────────
  { entity: SysUserRoleEntity, reason: 'sys_user_role 是 junction：随 user/role 主行生灭，不是业务数据行' },
  { entity: SysRoleMenuEntity, reason: 'sys_role_menu 是 junction：随 role/menu 主行生灭，不是业务数据行' },
]

/** 小数（smallint）→ 模式串；非法值返回 null（调用方按默认拒绝处理） */
export function toWalnutDataScopeMode(value: unknown): IWalnutAdminDataScopeMode | null {
  if (value === WalnutAdminConstDataScope.ALL) {
    return WalnutAdminConstDataScopeMode.ALL
  }
  if (value === WalnutAdminConstDataScope.SELF) {
    return WalnutAdminConstDataScopeMode.SELF
  }
  if (value === WalnutAdminConstDataScope.CUSTOM) {
    return WalnutAdminConstDataScopeMode.CUSTOM
  }
  return null
}

/**
 * 查注册表。`entityTarget` 可能是实体类、字符串表名或 EntitySchema —— 统一按
 * 调用方传入的 TypeORM 元数据 `target`（实体类引用）比较。
 */
export function getWalnutDataScopeEntityConfig(
  entity: EntityTarget<ObjectLiteral> | undefined,
): IWalnutAdminDataScopeEntityConfig | undefined {
  return WALNUT_DATA_SCOPE_ENTITIES.find(config => config.entity === entity)
}

export function isWalnutDataScopeRegisteredEntity(entity: EntityTarget<ObjectLiteral> | undefined): boolean {
  return getWalnutDataScopeEntityConfig(entity) !== undefined
}

export interface IWalnutAdminDataScopeSqlPredicate {
  /** 参数化 where 片段（不含 WHERE 关键字，调用方用 andWhere 追加） */
  clause: string
  params: Record<string, unknown>
}

/**
 * 构造 list/QueryBuilder 用的参数化谓词 —— 决策层（描述符）与执行层（SQL）的唯一
 * 衔接点。ALL 返回 null（不注入）；CUSTOM 空集返回恒假（默认拒绝）。
 *
 * @param config 实体注册项（owner 列 + allowAnonymous）
 * @param descriptor 数据权限描述符（模式 + CUSTOM userIds）
 * @param userId 当前用户（SELF 的取值）
 * @param alias QueryBuilder 的主别名（基类固定 `entity`）
 * @param paramPrefix 参数名前缀（同一查询只会注入一次 scope，固定前缀即可）
 */
export function buildWalnutDataScopeSqlPredicate(
  config: IWalnutAdminDataScopeEntityConfig,
  descriptor: IWalnutAdminDataScopeDescriptor,
  userId: string,
  alias: string,
  paramPrefix = 'walnut_data_scope',
): IWalnutAdminDataScopeSqlPredicate | null {
  if (descriptor.mode === WalnutAdminConstDataScopeMode.ALL) {
    return null
  }

  const column = `${alias}.${config.scopeColumn}`
  const userParam = `${paramPrefix}_user`
  const listParam = `${paramPrefix}_users`

  if (descriptor.mode === WalnutAdminConstDataScopeMode.SELF) {
    if (config.allowAnonymous) {
      return {
        clause: `(${column} = :${userParam} OR ${column} IS NULL)`,
        params: { [userParam]: userId },
      }
    }
    return {
      clause: `${column} = :${userParam}`,
      params: { [userParam]: userId },
    }
  }

  const userIds = [...new Set(descriptor.userIds ?? [])]
  if (userIds.length === 0) {
    // 默认拒绝：无角色 / CUSTOM 空集 / 非法档位都收敛到这里
    return { clause: '1 = 0', params: {} }
  }

  if (config.allowAnonymous) {
    return {
      clause: `(${column} IN (:...${listParam}) OR ${column} IS NULL)`,
      params: { [listParam]: userIds },
    }
  }

  return {
    clause: `${column} IN (:...${listParam})`,
    params: { [listParam]: userIds },
  }
}

/** FindOptionsWhere 形态的 scope 面：null = 不限制；'deny' = 默认拒绝 */
export type WalnutDataScopeFindWhere<Entity extends ObjectLiteral>
  = | FindOptionsWhere<Entity>[]
    | 'deny'
    | null

/**
 * 构造 Repository.find/findOne 用的 scope where 数组（OR 关系）。
 * 与 `buildWalnutDataScopeSqlPredicate` 同源语义，供 readById / updateByField /
 * deleteSoftManyByCondition 这类走 Repository API 的路径使用。
 */
export function buildWalnutDataScopeFindWhere<Entity extends ObjectLiteral>(
  config: IWalnutAdminDataScopeEntityConfig,
  descriptor: IWalnutAdminDataScopeDescriptor,
  userId: string,
): WalnutDataScopeFindWhere<Entity> {
  if (descriptor.mode === WalnutAdminConstDataScopeMode.ALL) {
    return null
  }

  const column = config.scopeColumn
  const ownerIsNull = { [column]: IsNull() }

  if (descriptor.mode === WalnutAdminConstDataScopeMode.SELF) {
    const ownerIsUser = { [column]: userId }
    return (config.allowAnonymous
      ? [ownerIsUser, ownerIsNull]
      : [ownerIsUser]) as FindOptionsWhere<Entity>[]
  }

  const userIds = [...new Set(descriptor.userIds ?? [])]
  if (userIds.length === 0) {
    return 'deny'
  }

  const ownerInUsers = { [column]: In(userIds) }
  return (config.allowAnonymous
    ? [ownerInUsers, ownerIsNull]
    : [ownerInUsers]) as FindOptionsWhere<Entity>[]
}

/**
 * 把 scope where 与业务条件合并成 OR 数组（每个 scope 分支都要带上业务条件）。
 * 空业务条件（undefined）时走纯 scope；'deny' 原样上抛给调用方处理（抛 404 / 返回空）。
 */
export function mergeWalnutDataScopeFindWhere<Entity extends ObjectLiteral>(
  base: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[] | undefined,
  scope: WalnutDataScopeFindWhere<Entity>,
): WalnutDataScopeFindWhere<Entity> {
  if (scope === 'deny') {
    return 'deny'
  }

  const bases = base === undefined
    ? [{} as FindOptionsWhere<Entity>]
    : (Array.isArray(base) ? base : [base])

  if (scope === null) {
    return bases
  }

  return bases.flatMap(baseWhere =>
    scope.map(scopeWhere => ({ ...baseWhere, ...scopeWhere })),
  )
}

/** QueryBuilder 便捷注入（基类与覆写 list 共用） */
export function applyWalnutDataScopePredicate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  config: IWalnutAdminDataScopeEntityConfig,
  descriptor: IWalnutAdminDataScopeDescriptor,
  userId: string,
): void {
  const predicate = buildWalnutDataScopeSqlPredicate(config, descriptor, userId, alias)
  if (predicate !== null) {
    qb.andWhere(predicate.clause, predicate.params)
  }
}

/**
 * 角色名 → 是否 root（root 恒 ALL；大小写不敏感由契约常量保证小写）。
 * 单独导出便于解析器单测与 resolver 复用。
 */
export function isWalnutDataScopeRootRole(roleName: string): boolean {
  return roleName === Role.ROOT
}
