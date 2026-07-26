import { Inject } from '@nestjs/common'
import { WalnutDBInjectConnection } from '@walnut/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut/exceptions/base/404'
import { buildListPipelineFromRequest } from '@walnut/utils/listAggregate'
import { cloneDeep } from 'lodash'
import { ClientSession, Connection, Model, PipelineStage, Types } from 'mongoose'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SysDeletedRepoService } from '@/modules/system/deleted/repo/deleted.repo.service'
import { IWalnutAdminRequestList, IWalnutAdminResponseList } from '../dto/list.dto'

export abstract class WalnutAdminCommonBasicRepository<T> {
  @Inject(ALSRequestService)
  protected readonly alsRequestService: ALSRequestService

  @WalnutDBInjectConnection()
  readonly dbConnection: Connection

  @Inject(SysDeletedRepoService)
  readonly deletedRepoService: SysDeletedRepoService

  constructor(readonly DBModel: Model<T>) { }

  /**
   * @description get collection name
   */
  private get getModelName() {
    return this.DBModel.modelName
  }

  /**
   * @description get collection name
   */
  private get getCollectionName() {
    return this.DBModel.collection.collectionName
  }

  /**
   * @description create
   */
  public async create(dto: Partial<T>, dbSession?: ClientSession) {
    if (dbSession) {
      const created = await this.DBModel.create([dto] as never, { session: dbSession })
      return created[0] as T
    }

    return this.DBModel.create(dto as never) as Promise<T>
  }

  /**
   * @description read
   */
  public async readById(id: string, dbSession?: ClientSession) {
    const read = await this.DBModel.findById(id).session(dbSession!)

    if (!read) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return read
  }

  /**
   * @description update one by id
   */
  public async update(id: string, dto: Partial<T>) {
    const res = await this.DBModel.findById(id)

    if (!res) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // before snapshot
    this.alsRequestService.set('snapshotBefore', cloneDeep(res))

    Object.entries(dto).forEach(([k, v]) => {
      if (k !== '_id') {
        // @ts-expect-error fuck u
        res[k] = v
      }
    })

    await res.save()

    // after snapshot
    this.alsRequestService.set('snapshotAfter', cloneDeep(res))

    return res
  }

  /**
   * @description update one by query
   */
  public async updateByField(query: Partial<T>, dto: Partial<T>, dbSession?: ClientSession) {
    const res = await this.DBModel.findOne(query, null).session(dbSession!)

    if (!res) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    Object.entries(dto).forEach(([k, v]) => {
      if (k !== '_id') {
        // @ts-expect-error fuck u
        res[k] = v
      }
    })

    await res.save({ session: dbSession })

    return res
  }

  /**
   * @description delete soft by id
   */
  public async deleteSoftById(id: string, userId: string, dbSession?: ClientSession) {
    const deleted = await this.DBModel.findById(id, null).session(dbSession!)

    if (!deleted) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    await this.deletedRepoService.createSoftDelete({
      content: JSON.stringify(deleted.toObject()),
      modelName: this.getModelName,
      collectionName: this.getCollectionName,
      deletedId: deleted._id as Types.ObjectId,
      deletedBy: new Types.ObjectId(userId),
    }, dbSession)

    // trigger findOneAndDelete middleware
    await this.DBModel.findByIdAndDelete(id).session(dbSession!)

    return deleted
  }

  /**
   * @description delete real by id
   */
  public async deleteRealById(id: string, dbSession?: ClientSession) {
    const deleted = await this.DBModel.findById(id).session(dbSession!)

    if (!deleted) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // trigger findOneAndDelete middleware
    await this.DBModel.findByIdAndDelete(id).session(dbSession!)

    return deleted
  }

  /**
   * @description delete soft multiple by ids
   */
  public async deleteSoftByIdMany(ids: string[], userId: string, dbSession?: ClientSession) {
    // do not use promise.all when use transaction
    // https://stackoverflow.com/questions/64084992/mongotransactionexception-query-failed-with-error-code-251/68393506#68393506
    const res: T[] = []
    for (const id of ids) {
      const deleted = await this.deleteSoftById(id, userId, dbSession)
      res.push(deleted)
    }
    return res
  }

  /**
   * @description delete real multiple by ids
   */
  public async deleteRealByIdMany(ids: string[], dbSession?: ClientSession) {
    const res: T[] = []
    for (const id of ids) {
      const deleted = await this.deleteRealById(id, dbSession)
      res.push(deleted)
    }
    return res
  }

  /**
   * @description delete soft by condition
   */
  public async deleteSoftManyByCondition(
    conditions: Partial<T>,
    userId: string,
    dbSession?: ClientSession,
  ) {
    const deleted = await this.DBModel.find(conditions, null).session(dbSession!)

    if (deleted === null) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    for (const element of deleted) {
      await this.deletedRepoService.createSoftDelete({
        content: JSON.stringify(element),
        modelName: this.getModelName,
        collectionName: this.getCollectionName,
        deletedId: element._id as Types.ObjectId,
        deletedBy: new Types.ObjectId(userId),
      }, dbSession)

      // trigger findOneAndDelete middleware
      await this.DBModel.findByIdAndDelete(element._id).session(dbSession!)
    }

    return deleted
  }

  /**
   * @description: Base list, with default pattern params
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    customPipeline: PipelineStage.FacetPipelineStage[] = [],
  ): Promise<IWalnutAdminResponseList<T>> {
    const pipeline = buildListPipelineFromRequest<T>(params, customPipeline)

    const [res] = await this.DBModel.aggregate<{
      data: T[]
      total: number
    }>(pipeline)

    return res
  }
}
