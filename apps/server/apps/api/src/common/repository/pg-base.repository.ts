import type { EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminDataScopeEntityConfig } from './data-scope'
import { Inject } from '@nestjs/common'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminExceptionDataScopeContextMissing } from '@walnut-server/exceptions/business/auth'

import { cloneDeep } from 'lodash'
import { DataSource } from 'typeorm'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SysDeletedPgRepoService } from '@/modules/system/deleted/repo/deleted.repo.pg.service'
import { IWalnutAdminRequestList } from '../dto/list.dto'
import {
  applyWalnutDataScopePredicate,
  buildWalnutDataScopeFindWhere,
  getWalnutDataScopeEntityConfig,
  mergeWalnutDataScopeFindWhere,
} from './data-scope'
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
 *   `em` 缺省走连接级 manager（非事务路径），语义同 Mongo 版的可选 dbSession。
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
   */
  protected getManager(em?: EntityManager): EntityManager {
    return em ?? this.dataSource.manager
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
   * @description create（PK 不传则由 DB 默认值生成，save 后回带 id）
   *
   * 注册实体 + `fillOwnerOnCreate !== false` 时**无条件**用当前用户覆盖 owner 列
   * （app_demo.created_by 等）：显式传入 owner 一律不尊重 —— DTO 白名单日后若误加
   * owner 列，也不能把行伪造成别人的。系统通道（ALL 且无用户）不回填。
   */
  public async create(dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    const config = this.getDataScopeEntityConfig()

    if (config !== undefined) {
      const { userId } = this.requireDataScopeContext()
      const shouldFill = config.fillOwnerOnCreate !== false && userId !== ''

      if (shouldFill) {
        // 不改调用方入参：浅拷贝后再覆盖 owner 列
        dto = { ...dto, [config.scopeColumn]: userId }
      }
    }

    const repository = this.getManager(em).getRepository(this.entityTarget)
    const created = repository.create(dto as never) as unknown as Entity
    return repository.save(created)
  }

  /**
   * @description read（带数据权限：越权读 = DataNotFound，不泄露行存在性）
   */
  public async readById(id: string, em?: EntityManager): Promise<Entity> {
    const where = this.buildScopedWhere({ id } as unknown as FindOptionsWhere<Entity>)

    if (where === 'deny') {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const read = await this.getManager(em).getRepository(this.entityTarget).findOne({
      where,
    })

    if (!read) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return read
  }

  /**
   * @description update one by id（前后快照进 ALS，供操作日志记录，语义同 Mongo 版）
   */
  public async update(id: string, dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    const repository = this.getManager(em).getRepository(this.entityTarget)

    const res = await this.readById(id, em)

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
  }

  /**
   * @description update one by query（带数据权限：越权行等同不存在）
   */
  public async updateByField(query: Partial<Entity>, dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    const repository = this.getManager(em).getRepository(this.entityTarget)

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
  }

  /**
   * @description delete soft by id：sys_deleted 快照 + 原行删除，同一 em 下即同一事务
   */
  public async deleteSoftById(id: string, userId: string, em?: EntityManager): Promise<Entity> {
    const deleted = await this.readById(id, em)

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
    }, em)

    await this.getManager(em).getRepository(this.entityTarget).remove(deleted)

    return snapshot
  }

  /**
   * @description delete real by id
   */
  public async deleteRealById(id: string, em?: EntityManager): Promise<Entity> {
    const deleted = await this.readById(id, em)

    // 同 deleteSoftById：remove() 会就地清空被删实体的生成列，返回删除前拷贝
    const snapshot: Entity = { ...deleted }

    await this.getManager(em).getRepository(this.entityTarget).remove(deleted)

    return snapshot
  }

  /**
   * @description delete soft multiple by ids（顺序执行 —— 事务内并发写不做 Promise.all，
   * 语义与 Mongo 版一致）
   */
  public async deleteSoftByIdMany(ids: string[], userId: string, em?: EntityManager): Promise<Entity[]> {
    const res: Entity[] = []
    for (const id of ids) {
      res.push(await this.deleteSoftById(id, userId, em))
    }
    return res
  }

  /**
   * @description delete real multiple by ids
   */
  public async deleteRealByIdMany(ids: string[], em?: EntityManager): Promise<Entity[]> {
    const res: Entity[] = []
    for (const id of ids) {
      res.push(await this.deleteRealById(id, em))
    }
    return res
  }

  /**
   * @description delete soft multiple by condition（命中 0 行返回空数组，与 Mongo 版
   * 有效行为一致；条件先按数据权限收窄，逐行删除仍走带 scope 的 readById）
   */
  public async deleteSoftManyByCondition(conditions: Partial<Entity>, userId: string, em?: EntityManager): Promise<Entity[]> {
    const where = this.buildScopedWhere(conditions)

    const found = where === 'deny'
      ? []
      : await this.getManager(em).getRepository(this.entityTarget).find({ where })

    const res: Entity[] = []
    for (const element of found) {
      res.push(await this.deleteSoftById((element as Entity & { id: string }).id, userId, em))
    }
    return res
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
    const qb = this.getManager(em).createQueryBuilder(this.entityTarget, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    customize?.(qb)

    this.applyDataScope(qb, 'entity')

    return executePgListQuery(qb)
  }
}
