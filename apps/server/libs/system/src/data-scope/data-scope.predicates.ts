import type { IWalnutAdminDataScopeDescriptor, IWalnutAdminDataScopeMode } from '@walnut-server/db'
import type {
  IWalnutAdminDataScopeDeptUpdateDecision,
  IWalnutAdminDataScopeEntityConfig,
  IWalnutAdminDataScopeSqlPredicate,
  WalnutDataScopeFindWhere,
} from '@walnut-server/repository'
import type { FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { Role } from '@walnut/contract'
import { In, IsNull } from 'typeorm'

/**
 * 数据权限**谓词构造**（纯函数，零 Nest/DB 依赖；批 7 随 data-scope 模块下沉 libs/system）。
 *
 * 实体注册表（`WALNUT_DATA_SCOPE_ENTITIES` / 豁免清单 / `getWalnutDataScopeEntityConfig`）
 * 仍留在 app 的 `common/repository/data-scope.ts` —— 它横跨 app（demo/monitor/setting/…）、
 * auth（refresh token）、shared（area）、identity 与 system 四层实体，下沉 lib 会立刻形成
 * lib → app；策略端口实现（`WALNUT_ADMIN_DATA_SCOPE_POLICY`）与注册表同层留 app，
 * 谓词/RLS 这类纯函数走本文件。
 *
 * 语义见 apps/docs/src/zh-CN/content/plans/data-scope-design.md §4，§7「残余过滤条件接口」；
 * 部门维度见 apps/docs/src/zh-CN/content/plans/data-scope-phase2-3-plan.md §1.1。
 *
 * 语义边界（重要）：
 * - **注册 = 强制过滤**：一经注册，`WalnutAdminCommonPgBaseRepository` 的
 *   list / readById / updateByField / delete* / create 全部按 owner 列注入 scope；
 * - **未注册 = 显式豁免**：全局共享表 / 安全面系统表不注册（逐条理由见
 *   `WALNUT_DATA_SCOPE_EXEMPT_ENTITIES`），查询不受数据权限影响；
 * - 机械守卫：`data-scope.spec.ts` 断言「所有含 owner 列的实体都已注册或登记豁免」
 *   「注册的 scopeColumn / deptColumn 都是实体真实列」。
 *
 * 执行语义（二期六档；解析在 ./data-scope.resolver.ts）：
 * - ALL：不注入谓词；
 * - SELF：`scopeColumn = 当前 userId`；
 * - DEPT / DEPT_AND_CHILD / CUSTOM：`deptColumn IN (:...deptIds)`（解析器已把
 *   DEPT_AND_CHILD 展开为子树、CUSTOM 读 sys_role_dept）；空集/实体无 deptColumn → 恒假；
 *   行级归属列由 create 回填（`fillDeptOnCreate`，取创建者的 sys_employee.dept_id）；
 * - DEPT_OR_SELF：`scopeColumn = 当前 userId OR deptColumn IN (:...deptIds)`（并集）。
 * `allowAnonymous` 的实体（在线监控）在 SELF / DEPT_OR_SELF 的 owner 腿上并上
 * `scopeColumn IS NULL`：未登录访客没有 owner，归为共享匿名行。
 */

/** 小数（smallint）→ 模式串；非法值返回 null（调用方按默认拒绝处理） */
export function toWalnutDataScopeMode(value: unknown): IWalnutAdminDataScopeMode | null {
  switch (value) {
    case WalnutAdminConstDataScope.ALL:
      return WalnutAdminConstDataScopeMode.ALL
    case WalnutAdminConstDataScope.CUSTOM:
      return WalnutAdminConstDataScopeMode.CUSTOM
    case WalnutAdminConstDataScope.DEPT:
      return WalnutAdminConstDataScopeMode.DEPT
    case WalnutAdminConstDataScope.DEPT_AND_CHILD:
      return WalnutAdminConstDataScopeMode.DEPT_AND_CHILD
    case WalnutAdminConstDataScope.SELF:
      return WalnutAdminConstDataScopeMode.SELF
    case WalnutAdminConstDataScope.DEPT_OR_SELF:
      return WalnutAdminConstDataScopeMode.DEPT_OR_SELF
    default:
      return null
  }
}

/**
 * 构造 list/QueryBuilder 用的参数化谓词 —— 决策层（描述符）与执行层（SQL）的唯一
 * 衔接点。ALL 返回 null（不注入）；部门系档位在空集/实体无 deptColumn 时返回恒假
 * （默认拒绝；DEPT_OR_SELF 的 SELF 腿除外）。
 *
 * @param config 实体注册项（owner 列 + dept 列 + allowAnonymous）
 * @param descriptor 数据权限描述符（模式 + userIds / deptIds）
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
  const deptParam = `${paramPrefix}_depts`

  const userIds = [...new Set((descriptor.userIds ?? []).filter(id => typeof id === 'string' && id !== ''))]
  const deptIds = [...new Set((descriptor.deptIds ?? []).filter(id => typeof id === 'string' && id !== ''))]

  const ownerClause = userIds.length > 0
    ? `${column} IN (:...${listParam})`
    : `${column} = :${userParam}`
  const ownerParams: Record<string, unknown> = userIds.length > 0
    ? { [listParam]: userIds }
    : { [userParam]: userId }

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

  if (descriptor.mode === WalnutAdminConstDataScopeMode.DEPT_OR_SELF) {
    const branches = [ownerClause]
    const params: Record<string, unknown> = { ...ownerParams }

    if (config.deptColumn !== undefined && deptIds.length > 0) {
      branches.push(`${alias}.${config.deptColumn} IN (:...${deptParam})`)
      params[deptParam] = deptIds
    }

    if (config.allowAnonymous) {
      branches.push(`${column} IS NULL`)
    }

    // 无 dept 列的实体退化为仅 SELF（并集里部门腿贡献为空，不泄露）
    return { clause: `(${branches.join(' OR ')})`, params }
  }

  // DEPT / DEPT_AND_CHILD / CUSTOM：只按部门维度过滤
  if (config.deptColumn === undefined || deptIds.length === 0) {
    // 默认拒绝：无角色 / CUSTOM 空清单 / dept 为 NULL 的 DEPT / 实体无 dept 列
    return { clause: '1 = 0', params: {} }
  }

  return {
    clause: `${alias}.${config.deptColumn} IN (:...${deptParam})`,
    params: { [deptParam]: deptIds },
  }
}

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
  const userIds = [...new Set(descriptor.userIds ?? [])]
  const deptIds = [...new Set(descriptor.deptIds ?? [])]

  if (descriptor.mode === WalnutAdminConstDataScopeMode.SELF) {
    const ownerIsUser = { [column]: userId }
    return (config.allowAnonymous
      ? [ownerIsUser, ownerIsNull]
      : [ownerIsUser]) as FindOptionsWhere<Entity>[]
  }

  if (descriptor.mode === WalnutAdminConstDataScopeMode.DEPT_OR_SELF) {
    const ownerBranch = userIds.length > 0
      ? { [column]: In(userIds) }
      : { [column]: userId }

    const branches: FindOptionsWhere<Entity>[] = [ownerBranch as FindOptionsWhere<Entity>]

    if (config.allowAnonymous) {
      branches.push(ownerIsNull as FindOptionsWhere<Entity>)
    }

    if (config.deptColumn !== undefined && deptIds.length > 0) {
      branches.push({ [config.deptColumn]: In(deptIds) } as FindOptionsWhere<Entity>)
    }

    // 无 dept 列的实体退化为仅 SELF（同 SQL 谓词）
    return branches
  }

  // DEPT / DEPT_AND_CHILD / CUSTOM
  if (config.deptColumn === undefined || deptIds.length === 0) {
    return 'deny'
  }

  return [{ [config.deptColumn]: In(deptIds) } as FindOptionsWhere<Entity>]
}

/**
 * update / updateByField 的 deptColumn 决策（纯函数，与谓词构造同层）—— 批 4 / L1。
 *
 * 语义：
 * - 实体无 deptColumn → 不涉及（allow）；
 * - policy `strip` → strip（与操作者档位无关：归属由 create 派生，创建后不可改）；
 * - policy `validate`（缺省）：ALL 豁免；DTO 未显式给出或值未变化 → allow；
 *   否则新值必须 ∈ 描述符 `deptIds`（DEPT_OR_SELF 只认部门腿，SELF 的空集即拒绝）。
 *   越界由调用方按 404 处理，与越权 readById 同口径（不泄露行存在性）。
 *
 * UUID 比较按小写归一化（PG 的 uuid 列不保留大小写，客户端可能传大写）。
 *
 * @param config 实体注册项（deptColumn + deptUpdatePolicy）
 * @param descriptor 操作者描述符
 * @param dto 提交的更新面（实体属性名口径，与基类 `Object.entries(dto)` 同一输入）
 * @param currentDeptId 目标行当前的 deptColumn 值（调用方已在 scoped 读里拿到原行）
 */
export function resolveWalnutDataScopeDeptUpdate(
  config: IWalnutAdminDataScopeEntityConfig,
  descriptor: IWalnutAdminDataScopeDescriptor,
  dto: Record<string, unknown>,
  currentDeptId: unknown,
): IWalnutAdminDataScopeDeptUpdateDecision {
  const deptColumn = config.deptColumn

  if (deptColumn === undefined) {
    return 'allow'
  }

  if ((config.deptUpdatePolicy ?? 'validate') === 'strip') {
    return 'strip'
  }

  if (descriptor.mode === WalnutAdminConstDataScopeMode.ALL) {
    return 'allow'
  }

  // 「显式给出」按自有属性判定：三类 deptId 字段都关了入参 booleanString Transform
  // （B1），未提交时属性缺失/undefined；显式 null 才表示清空部门。
  if (!Object.hasOwn(dto, deptColumn)) {
    return 'allow'
  }

  const normalizeDeptId = (value: unknown): string | null | undefined =>
    value === undefined ? undefined : typeof value === 'string' ? value.toLowerCase() : null

  const nextDeptId = normalizeDeptId(dto[deptColumn])
  const current = normalizeDeptId(currentDeptId)

  if (nextDeptId === undefined || nextDeptId === current) {
    return 'allow'
  }

  const deptIds = new Set(
    (descriptor.deptIds ?? [])
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .map(id => id.toLowerCase()),
  )

  return nextDeptId !== null && deptIds.has(nextDeptId) ? 'allow' : 'deny'
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
