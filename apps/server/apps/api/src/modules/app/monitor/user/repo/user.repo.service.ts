import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName, WalnutDBVirtualName } from '@walnut/db'
import { ClientSession, QueryFilter, QueryOptions, Types, UpdateQuery } from 'mongoose'
import { IAppMonitorUserDocument, IAppMonitorUserModel } from '../schema/user.schema'

@Injectable()
export class AppMonitorUserRepositoryService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_MONITOR_USER)
    private readonly appMonitorUserModel: IAppMonitorUserModel,
  ) {}

  /**
   * @description find monitor user by filter and update
   */
  async findOneAndUpdate(
    filter: QueryFilter<IAppMonitorUserDocument>,
    update: UpdateQuery<IAppMonitorUserDocument>,
    options: QueryOptions<IAppMonitorUserDocument>,
    dbSession?: ClientSession,
  ) {
    return this.appMonitorUserModel.findOneAndUpdate(
      filter,
      update,
      options,
    ).session(dbSession!)
  }

  /**
   * @description find monitor by monitor user document id
   */
  async findByMonitorId(id: string, dbSession?: ClientSession) {
    return this.appMonitorUserModel.findById(id).session(dbSession!)
  }

  /**
   * @description find active monitor by device id (not left)
   */
  async findActiveByDeviceId(deviceId: string) {
    return this.appMonitorUserModel.findOne({ left: false, deviceId })
  }

  /**
   * @description delete monitor by device id
   */
  async delMonitorByDeviceId(deviceId: string) {
    return this.appMonitorUserModel.findOneAndDelete({
      deviceId,
    })
  }

  /**
   * @description find all monitors by user id
   */
  async findAllByUserId(userId: string) {
    return this.appMonitorUserModel.find({
      userId: new Types.ObjectId(userId),
    })
  }

  /**
   * @description find monitor by user id and device id
   */
  async findByUserIdAndDeviceId(userId: string, deviceId: string, dbSession?: ClientSession) {
    return this.appMonitorUserModel.findOne({
      userId: new Types.ObjectId(userId),
      deviceId,
    }).session(dbSession!)
  }

  /**
   * @description find monitor with populated user
   */
  async findActiveUserByDeviceId(deviceId: string) {
    const monitorData = await this.appMonitorUserModel.findOne({
      left: false,
      deviceId,
    })

    if (!monitorData)
      return null

    await monitorData.populate({ path: WalnutDBVirtualName.USER, select: 'nickName userName' })

    return monitorData.populated_user
  }
}
