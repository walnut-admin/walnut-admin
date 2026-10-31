import type {
  IWalnutAdminDataScopeDeptUpdateDecision,
  IWalnutAdminDataScopeEntityConfig,
  IWalnutAdminDataScopeSqlPredicate,
  WalnutDataScopeFindWhere,
} from '@walnut-server/repository'
import type { EntityTarget, ObjectLiteral } from 'typeorm'
import { SysUserDeviceEntity, SysUserEntity, SysUserIdentityEntity, SysUserLockEntity, SysUserMfaEntity, SysUserOauthEntity, SysUserPreferenceEntity, SysUserRoleEntity } from '@walnut-server/identity'
import { SysDeletedEntity } from '@walnut-server/repository'
import {
  SysDeptEntity,
  SysDeviceEntity,
  SysDictDataEntity,
  SysDictTypeEntity,
  SysEmployeeEntity,
  SysLangEntity,
  SysLocaleEntity,
  SysLogAuthEntity,
  SysLogOperateEntity,
  SysMenuEntity,
  SysPostEntity,
  SysRoleDeptEntity,
  SysRoleEntity,
  SysRoleMenuEntity,
} from '@walnut-server/system'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { AppErrorEntity } from '@/modules/app/error/entity/error.entity'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { AppMonitorUserEntity } from '@/modules/app/monitor/user/entity/monitor-user.entity'
import { AppSettingEntity } from '@/modules/app/setting/entity/setting.entity'
import { AuthRefreshTokenEntity } from '@/modules/auth/modules/refresh/entity/refresh-token.entity'
import { SharedAreaEntity } from '@/modules/shared/area/entity/area.entity'

/**
 * 数据权限的**实体注册表**（app 侧，跨域实体清单的唯一真源）。
 *
 * 批 7：纯谓词函数已随 data-scope 模块下沉 `@walnut-server/system`
 * （`data-scope.predicates.ts`），本文件只保留实体清单 / 豁免清单 / 查表函数，
 * 并 re-export 谓词函数保持既有 import 面不变。清单横跨 app / auth / shared / identity
 * 四层实体，因此不能进 lib（lib 不 import app）；策略端口实现
 * `common/repository/data-scope.policy.ts` 与本文件同层。
 *
 * 语义见 docs/plans/data-scope-design.md §4，§7「残余过滤条件接口」；
 * 部门维度见 docs/plans/data-scope-phase2-3-plan.md §1.1。
 *
 * 语义边界（重要）：
 * - **注册 = 强制过滤**：一经注册，`WalnutAdminCommonPgBaseRepository` 的
 *   list / readById / updateByField / delete* / create 全部按 owner 列注入 scope；
 * - **未注册 = 显式豁免**：全局共享表 / 安全面系统表不注册（逐条理由见
 *   `WALNUT_DATA_SCOPE_EXEMPT_ENTITIES`），查询不受数据权限影响；
 * - 机械守卫：`data-scope.spec.ts` 断言「所有含 owner 列的实体都已注册或登记豁免」
 *   「注册的 scopeColumn / deptColumn 都是实体真实列」。
 *
 * 执行语义（二期六档；解析在 modules/system/data-scope/data-scope.resolver.ts）：
 * - ALL：不注入谓词；
 * - SELF：`scopeColumn = 当前 userId`；
 * - DEPT / DEPT_AND_CHILD / CUSTOM：`deptColumn IN (:...deptIds)`（解析器已把
 *   DEPT_AND_CHILD 展开为子树、CUSTOM 读 sys_role_dept）；空集/实体无 deptColumn → 恒假；
 *   行级归属列由 create 回填（`fillDeptOnCreate`，取创建者的 sys_employee.dept_id）；
 * - DEPT_OR_SELF：`scopeColumn = 当前 userId OR deptColumn IN (:...deptIds)`（并集）。
 * `allowAnonymous` 的实体（在线监控）在 SELF / DEPT_OR_SELF 的 owner 腿上并上
 * `scopeColumn IS NULL`：未登录访客没有 owner，归为共享匿名行。
 */

export type {
  IWalnutAdminDataScopeDeptUpdateDecision,
  IWalnutAdminDataScopeEntityConfig,
  IWalnutAdminDataScopeSqlPredicate,
  WalnutDataScopeFindWhere,
}

/**
 * 注册清单（带 owner / dept 语义的业务表）。
 *
 * 为什么只有这些：数据权限的目标是「业务数据行」，先把**有明确归属**的表纳入；
 * 全局共享表与登录/安全面系统表不注册（见豁免清单）。
 */
export const WALNUT_DATA_SCOPE_ENTITIES: ReadonlyArray<IWalnutAdminDataScopeEntityConfig> = [
  {
    entity: SysUserEntity,
    scopeColumn: 'id',
    deptColumn: 'deptId',
    fillOwnerOnCreate: false,
    note: 'sys_user：SELF = 本人账号行（id 即 owner）；部门系档位按 dept_id 过滤（DEPT 看本部门、DEPT_AND_CHILD 看子树）。create 不回填主键；update 的 dept_id 走 validate（显式改部门必须在操作者 deptIds 内，未给/未变化放行）。',
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
    deptColumn: 'deptId',
    fillDeptOnCreate: true,
    // 行级归属（owner + dept）都由 create 派生；update 不接受改归属（批 4 / L1）
    deptUpdatePolicy: 'strip',
    note: 'app_demo：示范 owner 列（created_by）+ 行级部门归属列（dept_id，二期批 2 方案 A 冗余列）。create 自动填当前用户与创建者职工部门（无职工行 → NULL = 仅 ALL 可见）；SELF 只看 owner，部门系档位只看 dept_id。update 的 deptId 一律剔除（归属创建后不可改）。',
  },
  {
    entity: SysEmployeeEntity,
    scopeColumn: 'userId',
    deptColumn: 'deptId',
    fillOwnerOnCreate: false,
    allowOwnerUpdate: true,
    note: 'sys_employee：人事记录挂账号（uq_employee_user 一号一职工）。user_id 是绑定语义不是创建者，create 不回填；update 允许改（仅 bind-user/unbind-user 入口）。部门系档位按 dept_id 过滤（批 1 的端到端靶表）；update 的 dept_id 走 validate（显式调部门须在操作者 deptIds 内，未给/未变化放行）。',
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
 * 判据：scope 只覆盖业务数据行；以下三类不在范围：
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
  // ── ③ 组织维度（部门树本身是全局组织数据，不是业务行）─────────────────────
  { entity: SysDeptEntity, reason: '部门树是全局组织数据：数据权限以它为维度（DEPT/DEPT_AND_CHILD 的解析输入），而不是对它做行级过滤' },
  { entity: SysPostEntity, reason: '岗位是全局组织数据（平表），不参与行级过滤；职工主表已注册' },
  // ── junction（随主行 CASCADE 生灭）────────────────────────────────────────
  { entity: SysUserRoleEntity, reason: 'sys_user_role 是 junction：随 user/role 主行生灭，不是业务数据行' },
  { entity: SysRoleMenuEntity, reason: 'sys_role_menu 是 junction：随 role/menu 主行生灭，不是业务数据行' },
  { entity: SysRoleDeptEntity, reason: 'sys_role_dept 是 junction：CUSTOM 档位的部门清单，随 role/dept 主行生灭；由解析器经 repo 读取，不参与行级过滤' },
]

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

// 批 7：谓词/RLS 纯函数随 data-scope 模块下沉 libs/system；这里 re-export 保持既有 import 面
// （common/repository/data-scope.spec.ts、eslint drift spec、策略实现体）不变。
export {
  applyWalnutDataScopePredicate,
  buildWalnutDataScopeFindWhere,
  buildWalnutDataScopeSqlPredicate,
  isWalnutDataScopeRootRole,
  mergeWalnutDataScopeFindWhere,
  resolveWalnutDataScopeDeptUpdate,
  toWalnutDataScopeMode,
} from '@walnut-server/system'
