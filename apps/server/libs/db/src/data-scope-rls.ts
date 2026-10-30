import type { DataSource, EntityManager } from 'typeorm'

/**
 * 数据权限三期（RLS）在**数据库连接上的注入面** —— 只关心「怎么把描述符写进事务」，
 * 不关心描述符怎么算（解析在 apps/api/src/modules/system/data-scope/，聚合在
 * apps/api/src/common/repository/data-scope.rls.ts）。
 *
 * 三条硬约束（docs/plans/data-scope-phase2-3-plan.md §2）：
 * 1. `set_config(..., true)` 是**事务级**设置 —— 必须与查询同连接同事务；会话级
 *    或池级 manager 上写会泄漏到下一个借到该连接的请求（业界 30 并发实测）。
 * 2. 事务提交/回滚后 PG 自动清空 local 设置，连接回池时不残留。
 * 3. 模式（mode）只允许四个值：
 *    - `all`：ALL 档位（root / runAsSystem），策略放行全部行；
 *    - `scoped`：其余档位，策略按 owner + dept 天花板过滤；
 *    - `system`：可信系统通道（登录链 / 在线监控心跳 / 非 HTTP cron），策略放行 ——
 *      必须由事务显式写入（见 `runInWalnutSystemTransaction`）；
 *    - `anonymous`：匿名 HTTP 请求，策略拒绝（fail-closed 0 行）。
 *
 * 策略函数按 mode 分支（见 DataScopePhase3Rls migration）；**未设置时缺省
 * `anonymous`（fail-closed）** —— 池级 manager 直连注册表不再有任何放行兜底。
 * 系统读腿必须显式走 `system` 事务；迁移/导出/seed 走管理角色（天然绕 RLS）。
 */
export const WALNUT_DATA_SCOPE_RLS_MODE = {
  ALL: 'all',
  SCOPED: 'scoped',
  SYSTEM: 'system',
  ANONYMOUS: 'anonymous',
} as const

export type IWalnutAdminDataScopeRlsMode = typeof WALNUT_DATA_SCOPE_RLS_MODE[keyof typeof WALNUT_DATA_SCOPE_RLS_MODE]

/** GUC 键名 —— 与迁移里的 `app.data_scope_*()` 函数逐字对齐 */
export const WALNUT_DATA_SCOPE_RLS_GUC = {
  MODE: 'app.data_scope.mode',
  USER_ID: 'app.data_scope.user_id',
  DEPT_IDS: 'app.data_scope.dept_ids',
  /**
   * 当前用户**账号自己的部门**（`sys_user.dept_id`）—— 只服务 sys_user / sys_employee
   * 的 WITH CHECK：允许「本人行、部门不变」的自助更新，但把 dept 改成天花板外的值
   * 会被拒绝（防止 SELF/DEPT 用户改自己 dept_id 借部门角色横向扩权）。
   */
  USER_DEPT_ID: 'app.data_scope.user_dept_id',
} as const

export interface IWalnutAdminDataScopeRlsSettings {
  mode: IWalnutAdminDataScopeRlsMode
  /** 当前用户 uuid；system / anonymous 时为空串（策略按空串 cast NULL 处理） */
  userId: string
  /** 部门天花板（已由解析器展开子树 / CUSTOM 清单）；空数组即「部门腿不贡献」 */
  deptIds: string[]
  /** 当前用户账号部门（无则空串）；仅 sys_user / sys_employee 的 WITH CHECK 使用 */
  userDeptId?: string
}

/**
 * 把 RLS 设置写进**当前事务**（local = true）。调用方必须保证 manager 属于一个
 * 已开启的事务（WalnutTxInterceptor 的 QueryRunner / 基类自动事务）。
 *
 * 一条 SELECT 写四个 GUC：避免四次往返；`set_config` 返回新值，结果本身无意义。
 */
export async function applyWalnutDataScopeRlsSettings(
  manager: Pick<EntityManager, 'query'>,
  settings: IWalnutAdminDataScopeRlsSettings,
): Promise<void> {
  const deptIds = [...new Set(settings.deptIds.filter(id => typeof id === 'string' && id !== ''))]

  await manager.query(
    'SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true), set_config($7, $8, true)',
    [
      WALNUT_DATA_SCOPE_RLS_GUC.MODE,
      settings.mode,
      WALNUT_DATA_SCOPE_RLS_GUC.USER_ID,
      settings.userId,
      WALNUT_DATA_SCOPE_RLS_GUC.DEPT_IDS,
      deptIds.join(','),
      WALNUT_DATA_SCOPE_RLS_GUC.USER_DEPT_ID,
      settings.userDeptId ?? '',
    ],
  )
}

/**
 * 在一条**独立事务**里以 `system` 模式执行回调 —— 系统读腿的显式入口。
 *
 * 为什么需要它：`app.data_scope_mode()` 缺省是 `anonymous`（fail-closed），池级
 * manager 直连注册表会被策略拒绝。登录链按用户名查 sys_user、日志旁写、在线监控
 * 心跳、测试/运维清理这类「没有请求用户、但必须读写注册表」的路径，必须把
 * `set_config(..., true)` 写在与查询同连接同事务上 —— 这正是本函数做的事。
 *
 * 与请求内 `system` 通道（`@WalnutAdminDecoratorDataScopeSystemChannel()`）的区别：
 * 那个标记只作用于 `@WalnutTx` 的请求事务；本函数覆盖无 `em` 的 repo service 调用。
 * 调用方若已经持有事务句柄 `em`，应直接用它（`withWalnutSystemManager` 已封装该分支），
 * 不要在外层事务里再开一条连接。
 */
export async function runInWalnutSystemTransaction<T>(
  dataSource: DataSource,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner()

  try {
    await queryRunner.connect()
    await queryRunner.startTransaction()
    await applyWalnutDataScopeRlsSettings(queryRunner.manager, {
      mode: WALNUT_DATA_SCOPE_RLS_MODE.SYSTEM,
      userId: '',
      deptIds: [],
    })

    const result = await fn(queryRunner.manager)
    await queryRunner.commitTransaction()
    return result
  }
  catch (e) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction().catch(() => undefined)
    }
    throw e
  }
  finally {
    await queryRunner.release()
  }
}

/**
 * 系统读腿的 manager 入口：有 `em` 直接用（调用方已在事务里，设置由
 * `WalnutTxInterceptor` / 基类自动事务负责），没有则开一条 `system` 事务。
 *
 * 注意：带 `em` 的路径仍受该事务的 RLS 设置约束（请求内是 actor 的天花板）。
 * 这是刻意的：同一请求里的系统读腿不应绕过当前用户的天花板；只有在**没有请求事务**
 * （guard / cron / socket / 事件旁路）时才需要独立的 system 事务。
 */
export async function withWalnutSystemManager<T>(
  dataSource: DataSource,
  em: EntityManager | undefined,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  if (em !== undefined) {
    return fn(em)
  }

  return runInWalnutSystemTransaction(dataSource, fn)
}
