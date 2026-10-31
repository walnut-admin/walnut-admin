import type { IWalnutAdminDataScopeDescriptor, IWalnutAdminDataScopeRlsSettings } from '@walnut-server/db'
import type { EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'

/**
 * 数据权限端口（libs 解耦批 5 的依赖反转）。
 *
 * 基类仓库的每一层（create / readById / update / delete* / list）都要读**实体注册表**
 * 并调用谓词构造器 —— 这些是 app 的领域聚合（`apps/api/src/common/repository/data-scope.ts`
 * 持有全实体清单，`data-scope.rls.ts` 持有描述符 → RLS 设置），libs/repository 不能
 * import（清单里全是 app 实体，且批 7 才随域搬迁）。端口把「基类需要的数据权限能力」
 * 收成一个窄接口：注册表查询 + 五个纯函数（FindOptions 谓词 / 合并 / dept 更新决策 /
 * QueryBuilder 谓词 / RLS 设置）+ create 的行级部门回填取数腿。
 *
 * 实现由 app 在 `WalnutAdminDataScopePolicyModule`（@Global）里用
 * `{ provide: WALNUT_ADMIN_DATA_SCOPE_POLICY, useExisting: WalnutAdminDataScopePolicyService }`
 * 绑定 —— 那层只做纯委托，实体清单与谓词语义**一行未搬**（批 7 随域处理）。
 *
 * 绑定缺失 = 启动期 DI 报错（必需注入，与解耦前「基类直接 import 模块级常量」总能
 * 解析的形态对齐：这里绝不允许退化成「空注册表 = 全部豁免」的 fail-open）。
 */
export const WALNUT_ADMIN_DATA_SCOPE_POLICY = Symbol('WALNUT_ADMIN_DATA_SCOPE_POLICY')

/**
 * 数据权限实体注册项（类型随基类下沉 libs/repository；实体清单仍在 app）。
 *
 * @see apps/api/src/common/repository/data-scope.ts 的 WALNUT_DATA_SCOPE_ENTITIES
 */
export interface IWalnutAdminDataScopeEntityConfig<Entity extends ObjectLiteral = ObjectLiteral> {
  /** TypeORM 实体类（与基类 `entityTarget` 同一引用） */
  entity: EntityTarget<Entity>
  /**
   * owner 列（**实体属性名**，不是数据库列名）—— QueryBuilder 与 FindOptions
   * 都用属性名，TypeORM 负责列名映射。
   */
  scopeColumn: keyof Entity & string
  /**
   * 部门列（**实体属性名**）—— DEPT / DEPT_AND_CHILD / CUSTOM / DEPT_OR_SELF 的
   * `deptColumn IN (:...deptIds)` 谓词列。未声明 = 该实体没有部门维度，部门系档位
   * **默认拒绝**（DEPT_OR_SELF 例外：退化为仅 SELF，不泄露）。
   */
  deptColumn?: keyof Entity & string
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
  /**
   * create 时是否用当前用户的**所属部门**回填 `deptColumn`（默认 false）。
   *
   * 取数腿：当前用户 → `sys_employee.dept_id`（一号一职工；无职工行 → NULL = 无部门归属）。
   * 与 owner 回填同一位置（基类 create），但语义不同 —— 只有「行级部门归属由创建者决定」
   * 的示范/业务表才开启（app_demo）；sys_user / sys_employee 的 dept 列是业务字段，不能回填。
   * 系统通道（ALL 且无用户）不回填。
   */
  fillDeptOnCreate?: boolean
  /**
   * update / updateByField 对 `deptColumn` 的处理策略，**缺省 `'validate'`**（fail-closed
   * 取向：新注册实体漏配即按严格侧）：
   *
   * - `'validate'`：DTO 显式给出 deptColumn 且值有变化时，新值必须 ∈ 操作者描述符的
   *   `deptIds`（ALL 豁免），越界按「查无此行」404 处理。与三期 RLS 的 WITH CHECK
   *   部门腿同语义 —— 应用层前置校验，失败更快且不依赖数据库连接通道；
   * - `'strip'`：deptColumn 从 update / updateByField 的 DTO 一律剔除（与 owner 列
   *   同通道）。用于「行级归属由创建者派生、创建后不可改」的表（app_demo）。
   */
  deptUpdatePolicy?: 'validate' | 'strip'
  /** 注册理由（必填：注册即强制过滤，理由要能被下一个人看懂） */
  note: string
}

export interface IWalnutAdminDataScopeSqlPredicate {
  /** 参数化 where 片段（不含 WHERE 关键字，调用方用 andWhere 追加） */
  clause: string
  params: Record<string, unknown>
}

/** FindOptionsWhere 形态的 scope 面：null = 不限制；'deny' = 默认拒绝 */
export type WalnutDataScopeFindWhere<Entity extends ObjectLiteral>
  = | FindOptionsWhere<Entity>[]
    | 'deny'
    | null

/** update 路径对 deptColumn 的处理决策：放行 / 从 DTO 剔除 / 按越权拒绝（404） */
export type IWalnutAdminDataScopeDeptUpdateDecision = 'allow' | 'strip' | 'deny'

/**
 * 基类仓库需要的数据权限能力（app 侧实现，见 WalnutAdminDataScopePolicyModule 的绑定）。
 *
 * 全部方法都是纯委托：注册表查询指向 `data-scope.ts` 的实体清单，其余指向同文件的
 * 纯函数 / `data-scope.rls.ts` 的 RLS 设置构造器。接口签名与解耦前基类的直接调用
 * 逐一对齐（零语义变化）。
 */
export interface IWalnutAdminDataScopePolicy {
  /** 实体 → 注册项（未注册 = 显式豁免，返回 undefined） */
  getEntityConfig: (entityTarget: EntityTarget<ObjectLiteral> | undefined) => IWalnutAdminDataScopeEntityConfig | undefined
  /** 构造 Repository.find/findOne 用的 scope where 数组（OR 关系） */
  buildFindWhere: <Entity extends ObjectLiteral>(
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    userId: string,
  ) => WalnutDataScopeFindWhere<Entity>
  /** scope where 与业务条件合并成 OR 数组（'deny' 原样上抛） */
  mergeFindWhere: <Entity extends ObjectLiteral>(
    base: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[] | undefined,
    scope: WalnutDataScopeFindWhere<Entity>,
  ) => WalnutDataScopeFindWhere<Entity>
  /** update / updateByField 的 deptColumn 决策 */
  resolveDeptUpdate: (
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    dto: Record<string, unknown>,
    currentDeptId: unknown,
  ) => IWalnutAdminDataScopeDeptUpdateDecision
  /** 给列表 QueryBuilder 追加数据权限谓词（andWhere，不可被 or 放宽） */
  applyPredicate: <T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    userId: string,
  ) => void
  /** 描述符 → 事务级 RLS 设置 */
  buildRlsSettings: (
    descriptor: IWalnutAdminDataScopeDescriptor | undefined,
    userId: string | undefined,
    options?: { systemChannel?: boolean, userDeptId?: string | null },
  ) => IWalnutAdminDataScopeRlsSettings
  /** create 的行级部门回填腿：取某账号的职工部门（无职工行 → null） */
  findOwnerDeptId: (userId: string, em?: EntityManager) => Promise<string | null>
}
