import type { EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminDataScopeEntityConfig } from './data-scope'
import { Inject } from '@nestjs/common'
import { applyWalnutDataScopeRlsSettings, DBTransactionHooksStore, runInWalnutSystemTransaction } from '@walnut-server/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import {
  WalnutAdminExceptionDataScopeContextMissing,
  WalnutAdminExceptionDataScopeTransactionRequired,
} from '@walnut-server/exceptions/business/auth'

import { cloneDeep } from 'lodash'
import { DataSource } from 'typeorm'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SysDeletedPgRepoService } from '@/modules/system/deleted/repo/deleted.repo.pg.service'
import { SysEmployeeEntity } from '@/modules/system/employee/entity/employee.entity'
import { IWalnutAdminRequestList } from '../dto/list.dto'
import {
  applyWalnutDataScopePredicate,
  buildWalnutDataScopeFindWhere,
  getWalnutDataScopeEntityConfig,
  mergeWalnutDataScopeFindWhere,
} from './data-scope'
import { buildWalnutDataScopeRlsSettings } from './data-scope.rls'
import { applyPgListQuery, buildPgListQueryOptions, executePgListQuery } from './pg-list.builder'

/**
 * PostgreSQL 版公共基类仓库 —— B9 起**唯一**基类（Mongo 版
 * `WalnutAdminCommonBasicRepository` 随 sys_deleted 双轨收口删除，历史形态见
 * git 存档），公共方法面（create / readById / update / updateByField /
 * deleteSoftById / deleteRealById / *_Many / deleteSoftManyByCondition / list）
 * 与 Mongo 版一一对齐，迁移批次把 repo 从 Mongo 版切到本基类时业务 service 的
 * 调用面不需要动。
 *
 * 与 Mongo 版的关键差异：
 * - 事务句柄是 `EntityManager`（取自 `WalnutTxContext.em`），不是 ClientSession；
 *   **注册实体**缺省 `em` 时自动开启事务（`withScopedManager`，数据权限三期），
 *   豁免实体维持连接级 manager 的旧形态。
 * - PK 约定：所有 B0a 实体的主键属性都是 `id: string`（uuid，DB 默认值生成 ——
 *   插入时不传 id 即走 `gen_random_uuid()` / `uuidv7()`）。
 * - deleteSoftById 的快照 content 直接存对象（jsonb），不再 JSON.stringify；
 *   modelName 沿用 `WalnutModelName` 的模型名（恢复注册表的路由键，phase2 5.3），
 *   collectionName 取实体元数据的表名。
 *
 * 泛型约束与用法：子类持有 `@InjectDataSource(WalnutPGConnectionName)` 的
 * DataSource 并连同 `EntityTarget` 传给 super；实体本身经 `TypeOrmModule.forFeature`
 * 注册（autoLoadEntities 通道），本基类只消费已注册的元数据。
 */
export abstract class WalnutAdminCommonPgBaseRepository<Entity extends ObjectLiteral> {
  @Inject(ALSRequestService)
  protected readonly alsRequestService: ALSRequestService

  @Inject(SysDeletedPgRepoService)
  readonly deletedRepoService: SysDeletedPgRepoService

  protected constructor(
    readonly entityTarget: EntityTarget<Entity>,
    readonly modelName: string,
    protected readonly dataSource: DataSource,
  ) { }

  /**
   * @description PG 表名（对应 Mongo 版的 collection name）
   */
  private get getTableName(): string {
    return this.dataSource.getMetadata(this.entityTarget).tableName
  }

  /**
   * @description 取事务内或连接级 manager
   *
   * **只给豁免实体与系统读腿用**（子类自定义方法）。基类的 scope 方法一律经
   * `withScopedManager`：注册实体在无 em 时不允许落到池级 manager —— RLS 的
   * `set_config(..., true)` 必须与查询同连接同事务，池级 manager 拿到的连接
   * 没有事务设置，等于让天花板失效。
   */
  protected getManager(em?: EntityManager): EntityManager {
    return em ?? this.dataSource.manager
  }

  /**
   * @description 已注册实体的 manager 入口（数据权限三期「读路径进事务」）
   *
   * 三种走法，按扰动从小到大：
   * 1. 调用方带 `em`（@WalnutTx 端点 / 上层自动事务）→ 直接用。事务里的 RLS 设置
   *    已由 WalnutTxInterceptor 或本方法写入；
   * 2. 豁免实体（未注册）→ 维持原行为，池级 manager，不开事务；
   * 3. 注册实体且无 em → **自动事务**：自建 QueryRunner，`startTransaction` 后先
   *    `set_config` 再执行，提交/回滚后释放。读方法用 `SET TRANSACTION READ ONLY`，
   *    写方法用普通事务。这是「单条查询本身即隐式事务」的补足 —— 单条 SELECT 虽然
   *    原子，但 RLS 设置必须和它落在同一连接上，池级 manager 无法保证。
   *
   * 为什么不在外层事务里再开一个：外层事务已经开启时，自动事务会借到**另一条连接**，
   * 既不是同一事务（看不到未提交数据 / 锁语义错位），也失去原子性 —— 这是显式的
   * 编程错误，抛 `DataScopeTransactionRequired`（500），要求调用方透传 em。
   */
  protected async withScopedManager<T>(
    em: EntityManager | undefined,
    fn: (manager: EntityManager) => Promise<T>,
    options: { readOnly?: boolean, systemWhenExempt?: boolean } = {},
  ): Promise<T> {
    if (em !== undefined) {
      return fn(em)
    }

    if (this.getDataScopeEntityConfig() === undefined) {
      // 软删路径即使实体本身豁免，也会写已注册的 sys_deleted（快照）——
      // 必须给它一个带 RLS 设置的事务，否则 fail-closed 策略会拒绝快照写入。
      if (options.systemWhenExempt === true) {
        return runInWalnutSystemTransaction(this.dataSource, fn)
      }

      return fn(this.dataSource.manager)
    }

    // 外层已有事务（WalnutTxInterceptor 的 DBTransactionHooksStore 上下文）却没拿到 em
    if (DBTransactionHooksStore.getStore() !== undefined) {
      throw new WalnutAdminExceptionDataScopeTransactionRequired()
    }

    // fail-closed 先于事务：无 ALS 上下文直接抛 403，不占用连接。
    // 优先取请求级预计算的设置（含账号部门，供 sys_user/sys_employee 的 WITH CHECK）；
    // 直接调仓库的测试/脚本没有这份设置时按描述符重算（userDeptId 为空）。
    const { descriptor, userId } = this.requireDataScopeContext()
    const settings = this.alsRequestService.get('rlsSettings')
      ?? buildWalnutDataScopeRlsSettings(descriptor, userId)

    const queryRunner = this.dataSource.createQueryRunner()
    try {
      await queryRunner.connect()
      await queryRunner.startTransaction()

      if (options.readOnly === true) {
        // 必须是事务里的第一条语句（PG 语义）；set_config 也是只读函数调用，不破坏只读
        await queryRunner.query('SET TRANSACTION READ ONLY')
      }

      await applyWalnutDataScopeRlsSettings(queryRunner.manager, settings)

      const result = await fn(queryRunner.manager)
      await queryRunner.commitTransaction()
      return result
    }
    catch (e) {
      // commit 已释放的 runner 不能再 rollback（同 tx.interceptor 的守卫）
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
   * @description 本实体的数据权限注册项（未注册 = 显式豁免，返回 undefined）
   *
   * 用 TypeORM 元数据的 `target`（实体类引用）比对 —— 基类构造器收到的
   * `entityTarget` 可能是 string / EntitySchema，统一收窄到类引用。
   */
  private getDataScopeEntityConfig(): IWalnutAdminDataScopeEntityConfig | undefined {
    const target = this.dataSource.getMetadata(this.entityTarget).target
    return getWalnutDataScopeEntityConfig(target)
  }

  /**
   * 取当前请求的数据权限上下文；未注册实体不受影响。
   *
   * fail-closed 语义（docs/plans/data-scope-design.md §7）：
   * - ALS 里没有描述符 → 抛 `WalnutAdminExceptionDataScopeContextMissing`（绝不当 ALL）；
   * - 非 HTTP 通道（cron / 脚本 / 测试）必须在 ALS 里显式
   *   `ALSRequestService.runAsSystem()` 进入系统通道（描述符 ALL），否则同样抛错。
   *
   * 守卫链先于 ALS 拦截器执行：guard 里查到已注册业务表也会走到这里 —— 所以
   * 「注册清单只放业务表、系统表不注册」是登录链不断的前提（见 data-scope.ts 豁免清单）。
   */
  private requireDataScopeContext() {
    const descriptor = this.alsRequestService.get('dataScope')
    const userId = this.alsRequestService.get('userId')

    if (descriptor === undefined) {
      throw new WalnutAdminExceptionDataScopeContextMissing()
    }

    // ALL 由系统通道（runAsSystem）提供时没有用户；SELF/CUSTOM 必须有当前用户
    if (descriptor.mode !== 'ALL' && userId === undefined) {
      throw new WalnutAdminExceptionDataScopeContextMissing()
    }

    return { descriptor, userId: userId ?? '' }
  }

  /**
   * 把数据权限谓词并入 Repository 的 where（业务条件 + scope 作 OR 分支展开）。
   * 返回 'deny' 时调用方按「查无此行」处理（DataNotFound / 空数组）。
   */
  protected buildScopedWhere(
    base: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[],
  ): FindOptionsWhere<Entity>[] | 'deny' {
    const config = this.getDataScopeEntityConfig()

    if (config === undefined) {
      return Array.isArray(base) ? base : [base]
    }

    const { descriptor, userId } = this.requireDataScopeContext()
    const scopeWhere = buildWalnutDataScopeFindWhere<Entity>(config, descriptor, userId)
    const merged = mergeWalnutDataScopeFindWhere(base, scopeWhere)

    if (merged === 'deny') {
      return 'deny'
    }

    return merged ?? (Array.isArray(base) ? base : [base])
  }

  /**
   * update / updateByField 里禁止外部赋值的 owner 列。
   * `allowOwnerUpdate` 的注册项（sys_employee 的绑定列）返回 undefined。
   */
  private getProtectedOwnerColumn(): string | undefined {
    const config = this.getDataScopeEntityConfig()

    if (config === undefined || config.allowOwnerUpdate === true) {
      return undefined
    }

    return config.scopeColumn
  }

  /**
   * 给列表 QueryBuilder 追加数据权限谓词（`andWhere`，不可被 or 放宽）。
   * 基类 list 在 customize 之后调用；覆写 list 的模块（user / deleted / monitor）
   * 也必须显式调用本方法（applyPgListQuery 之后）。
   */
  protected applyDataScope<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias = 'entity'): void {
    const config = this.getDataScopeEntityConfig()

    if (config === undefined) {
      return
    }

    const { descriptor, userId } = this.requireDataScopeContext()
    applyWalnutDataScopePredicate(qb, alias, config, descriptor, userId)
  }

  /**
   * @description 取某账号的职工部门（create 的行级部门回填腿；无职工行 → null）
   *
   * 系统级只读查询：回填必须看到「创建者此刻的真实部门」，不受行级 scope 影响
   * （此处位于 common/repository，ESLint 的直连守卫对本目录豁免）。
   */
  private async findOwnerDeptId(userId: string, em?: EntityManager): Promise<string | null> {
    const employee = await this.getManager(em).getRepository(SysEmployeeEntity).findOne({
      where: { userId },
      select: { deptId: true },
    })

    return employee?.deptId ?? null
  }

  /**
   * @description create（PK 不传则由 DB 默认值生成，save 后回带 id）
   *
   * 注册实体 + `fillOwnerOnCreate !== false` 时**无条件**用当前用户覆盖 owner 列
   * （app_demo.created_by 等）：显式传入 owner 一律不尊重 —— DTO 白名单日后若误加
   * owner 列，也不能把行伪造成别人的。系统通道（ALL 且无用户）不回填。
   *
   * `fillDeptOnCreate`（二期批 2）：行级部门归属与 owner 一样由 create 决定 —— 取创建者
   * 的 `sys_employee.dept_id`（无职工行 → NULL，仅 ALL 可见）。两处回填都发生在
   * repository.create 之前，调用方 DTO 不需要（也不允许）携带这两个归属列。
   */
  public async create(dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const config = this.getDataScopeEntityConfig()

      if (config !== undefined) {
        const { userId } = this.requireDataScopeContext()
        const shouldFillOwner = config.fillOwnerOnCreate !== false && userId !== ''

        if (shouldFillOwner) {
          // 不改调用方入参：浅拷贝后再覆盖 owner 列
          dto = { ...dto, [config.scopeColumn]: userId }
        }

        if (config.fillDeptOnCreate === true && config.deptColumn !== undefined && userId !== '') {
          dto = { ...dto, [config.deptColumn]: await this.findOwnerDeptId(userId, manager) }
        }
      }

      const repository = manager.getRepository(this.entityTarget)
      const created = repository.create(dto as never) as unknown as Entity
      return repository.save(created)
    })
  }

  /**
   * @description read（带数据权限：越权读 = DataNotFound，不泄露行存在性）
   */
  public async readById(id: string, em?: EntityManager): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const where = this.buildScopedWhere({ id } as unknown as FindOptionsWhere<Entity>)

      if (where === 'deny') {
        throw new WalnutAdminExceptionDataNotFound()
      }

      const read = await manager.getRepository(this.entityTarget).findOne({
        where,
      })

      if (!read) {
        throw new WalnutAdminExceptionDataNotFound()
      }

      return read
    }, { readOnly: true })
  }

  /**
   * @description update one by id（前后快照进 ALS，供操作日志记录，语义同 Mongo 版）
   */
  public async update(id: string, dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const repository = manager.getRepository(this.entityTarget)

      const res = await this.readById(id, manager)

      this.alsRequestService.set('snapshotBefore', cloneDeep(res))

      // P2 纵深防御：owner 列只由 create 当前用户回填，update 一律不接受（DTO 未来
      // 误加 owner 字段也不能把行转让给别人）；sys_employee 的绑定列例外
      const ownerColumn = this.getProtectedOwnerColumn()

      Object.entries(dto).forEach(([k, v]) => {
        if (k !== 'id' && k !== ownerColumn) {
          (res as Record<string, unknown>)[k] = v
        }
      })

      await repository.save(res)

      this.alsRequestService.set('snapshotAfter', cloneDeep(res))

      return res
    })
  }

  /**
   * @description update one by query（带数据权限：越权行等同不存在）
   */
  public async updateByField(query: Partial<Entity>, dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const repository = manager.getRepository(this.entityTarget)

      const where = this.buildScopedWhere(query)

      if (where === 'deny') {
        throw new WalnutAdminExceptionDataNotFound()
      }

      const res = await repository.findOne({ where })

      if (!res) {
        throw new WalnutAdminExceptionDataNotFound()
      }

      // P2 纵深防御：同 update，owner 列不接受外部赋值（sys_employee 绑定列例外）
      const ownerColumn = this.getProtectedOwnerColumn()

      Object.entries(dto).forEach(([k, v]) => {
        if (k !== 'id' && k !== ownerColumn) {
          (res as Record<string, unknown>)[k] = v
        }
      })

      return repository.save(res)
    })
  }

  /**
   * @description delete soft by id：sys_deleted 快照 + 原行删除，同一 em 下即同一事务
   */
  public async deleteSoftById(id: string, userId: string, em?: EntityManager): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const deleted = await this.readById(id, manager)

      // TypeORM 的 remove() 会就地变更传入实体（删除后生成列被置空），快照与返回值
      // 都取删除前的浅拷贝，不能直接把被删实体交出去
      const snapshot: Entity = { ...deleted }

      await this.deletedRepoService.createSoftDelete({
        content: snapshot,
        modelName: this.modelName,
        collectionName: this.getTableName,
        // PK 属性约定为 id（见类注释），泛型上无以声明，取前收窄
        deletedId: (snapshot as Entity & { id: string }).id,
        deletedBy: userId,
      }, manager)

      await manager.getRepository(this.entityTarget).remove(deleted)

      return snapshot
    }, { systemWhenExempt: true })
  }

  /**
   * @description delete real by id
   */
  public async deleteRealById(
    id: string,
    em?: EntityManager,
    options: { assertAffected?: boolean } = {},
  ): Promise<Entity> {
    return this.withScopedManager(em, async (manager) => {
      const deleted = await this.readById(id, manager)

      // 同 deleteSoftById：remove() 会就地清空被删实体的生成列，返回删除前拷贝
      const snapshot: Entity = { ...deleted }

      if (options.assertAffected === true) {
        // P3-9：recoverSnapshot 等「读后必删」路径断言恰好命中 1 行 —— 并发删除 /
        // 条件写坏不能静默留下一条已恢复的业务行 + 残留快照。
        const result = await manager.getRepository(this.entityTarget).delete({ id } as never)
        if (result.affected !== 1) {
          throw new WalnutAdminExceptionDataNotFound()
        }
      }
      else {
        await manager.getRepository(this.entityTarget).remove(deleted)
      }

      return snapshot
    })
  }

  /**
   * @description delete soft multiple by ids（顺序执行 —— 事务内并发写不做 Promise.all，
   * 语义与 Mongo 版一致）
   */
  public async deleteSoftByIdMany(ids: string[], userId: string, em?: EntityManager): Promise<Entity[]> {
    return this.withScopedManager(em, async (manager) => {
      const res: Entity[] = []
      for (const id of ids) {
        res.push(await this.deleteSoftById(id, userId, manager))
      }
      return res
    }, { systemWhenExempt: true })
  }

  /**
   * @description delete real multiple by ids
   */
  public async deleteRealByIdMany(ids: string[], em?: EntityManager): Promise<Entity[]> {
    return this.withScopedManager(em, async (manager) => {
      const res: Entity[] = []
      for (const id of ids) {
        res.push(await this.deleteRealById(id, manager))
      }
      return res
    })
  }

  /**
   * @description delete soft multiple by condition（命中 0 行返回空数组，与 Mongo 版
   * 有效行为一致；条件先按数据权限收窄，逐行删除仍走带 scope 的 readById）
   */
  public async deleteSoftManyByCondition(conditions: Partial<Entity>, userId: string, em?: EntityManager): Promise<Entity[]> {
    return this.withScopedManager(em, async (manager) => {
      const where = this.buildScopedWhere(conditions)

      const found = where === 'deny'
        ? []
        : await manager.getRepository(this.entityTarget).find({ where })

      const res: Entity[] = []
      for (const element of found) {
        res.push(await this.deleteSoftById((element as Entity & { id: string }).id, userId, manager))
      }
      return res
    }, { systemWhenExempt: true })
  }

  /**
   * @description Base list（默认模式参数，出参 `{ data, total }` 与 Mongo 版消费端兼容）。
   * `customize` 用于 JOIN / 子查询级的列表改写（对应 Mongo 版 customPipeline 的
   * QueryBuilder 等价物，约束见 pg-list.builder.ts 头注释）。
   *
   * 数据权限在 customize **之后**以 `andWhere` 追加（不可被自定义 OR 放宽）；
   * 覆写 list 的子类必须自行调用 `this.applyDataScope(qb)`。
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    customize?: (qb: SelectQueryBuilder<Entity>) => void,
    em?: EntityManager,
  ): Promise<{ data: Entity[], total: number }> {
    return this.withScopedManager(em, async (manager) => {
      const qb = manager.createQueryBuilder(this.entityTarget, 'entity')

      applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

      customize?.(qb)

      this.applyDataScope(qb, 'entity')

      return executePgListQuery(qb)
    }, { readOnly: true })
  }
}
