import type { EntityManager, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import { Inject } from '@nestjs/common'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { cloneDeep } from 'lodash'
import { DataSource } from 'typeorm'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SysDeletedPgRepoService } from '@/modules/system/deleted/repo/deleted.repo.pg.service'
import { IWalnutAdminRequestList } from '../dto/list.dto'
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
 *   modelName 沿用 `WalnutDBModelName` 的模型名（恢复注册表的路由键，phase2 5.3），
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
   * @description create（PK 不传则由 DB 默认值生成，save 后回带 id）
   */
  public async create(dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    const repository = this.getManager(em).getRepository(this.entityTarget)
    const created = repository.create(dto as never) as unknown as Entity
    return repository.save(created)
  }

  /**
   * @description read
   */
  public async readById(id: string, em?: EntityManager): Promise<Entity> {
    const read = await this.getManager(em).getRepository(this.entityTarget).findOne({ where: { id } as never })

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

    Object.entries(dto).forEach(([k, v]) => {
      if (k !== 'id') {
        (res as Record<string, unknown>)[k] = v
      }
    })

    await repository.save(res)

    this.alsRequestService.set('snapshotAfter', cloneDeep(res))

    return res
  }

  /**
   * @description update one by query
   */
  public async updateByField(query: Partial<Entity>, dto: Partial<Entity>, em?: EntityManager): Promise<Entity> {
    const repository = this.getManager(em).getRepository(this.entityTarget)

    const res = await repository.findOne({ where: query })

    if (!res) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    Object.entries(dto).forEach(([k, v]) => {
      if (k !== 'id') {
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
   * 有效行为一致）
   */
  public async deleteSoftManyByCondition(conditions: Partial<Entity>, userId: string, em?: EntityManager): Promise<Entity[]> {
    const found = await this.getManager(em).getRepository(this.entityTarget).find({ where: conditions as never })

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
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    customize?: (qb: SelectQueryBuilder<Entity>) => void,
    em?: EntityManager,
  ): Promise<{ data: Entity[], total: number }> {
    const qb = this.getManager(em).createQueryBuilder(this.entityTarget, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    customize?.(qb)

    return executePgListQuery(qb)
  }
}
