import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBCollectionName, WalnutDBVirtualName } from '@walnut/db'

import { buildListPipelineFromRequest } from '@walnut/utils/listAggregate'
import { isNil } from 'lodash'
import { ClientSession, PipelineStage } from 'mongoose'
import { AuthRefreshSharedService } from '@/modules/auth/modules/refresh/shared/refresh.shared.service'
import { AuthSignoutService } from '@/modules/auth/modules/signout/signout.service'
import { SysDeviceSharedService } from '@/modules/system/device/shared/device.shared.service'
import { SysUserDeviceRepositoryService } from '@/modules/system/user_device/repo/user_device.repo.service'
import { AppMonitorUserDTO, AppMonitorUserDTOListRequest } from './dto/user.dto'
import { AppMonitorUserRepositoryService } from './repo/user.repo.service'
import { IAppMonitorUserDocument } from './schema/user.schema'
import { AppMonitorUserBasicRepository } from './user.basic.repository'

@Injectable()
export class AppMonitorUserService {
  private readonly logger = new Logger(AppMonitorUserService.name)

  constructor(
    private readonly appMonitorUserBasicRepo: AppMonitorUserBasicRepository,
    private readonly sysUserDeviceRepo: SysUserDeviceRepositoryService,

    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly deviceSharedService: SysDeviceSharedService,

    private readonly appMonitorUserRepoService: AppMonitorUserRepositoryService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description main service to update user state
   */
  async updateState(
    deviceId: string,
    dto: Partial<AppMonitorUserDTO>,
    dbSession: ClientSession,
  ) {
    if (dto.auth === false) {
      dto.userId = null
    }

    // update doc
    const doc = await this.appMonitorUserRepoService.findOneAndUpdate(
      { visitorId: dto.visitorId },
      { deviceId, ...Object.fromEntries(Object.entries(dto).filter(([_, v]) => !isNil(v))) },
      { upsert: true, returnDocument: 'after' },
      dbSession,
    )

    if (!doc) {
      this.logger.error(`[UpdateState] | monitor user not found: ${dto.visitorId}`)
      return false
    }

    // update user device last active at
    await this.sysUserDeviceRepo.updateUserDeviceLastActiveAt(deviceId, doc.userId?.toString(), dbSession)

    // update device active status
    await this.deviceSharedService.updateDeviceActive(deviceId, !doc.left, dbSession)

    return true
  }

  /**
   * @description force quit through monitorId
   */
  async forceQuitByMonitorId(id: string, dbSession: ClientSession) {
    const appMonitor = await this.appMonitorUserRepoService.findByMonitorId(id, dbSession)

    if (appMonitor === null) {
      this.logger.warn(`monitor user not found: ${id}`)
      return false
    }

    return this.signoutService.doSignout(
      appMonitor.userId?.toString() as string,
      {
        trigger: 'admin-kick',
        deviceId: appMonitor?.deviceId,
        fingerprint: appMonitor?.visitorId,
        isOnline: !appMonitor?.left,
      },
      dbSession,
    )
  }

  /**
   * @description force quit through userId & deviceId, used for socket initial connection
   */
  async handleSocketInitForceQuit(userId: string, deviceId: string) {
    const { revoked, revokeReason } = await this.authRefreshSharedService.getTokenRevokedByDeviceIdAndUserId(deviceId, userId)

    if (revoked) {
      this.logger.log(
        `Device reconnect detected revoked token - user: ${userId}, device: ${deviceId}, reason: ${revokeReason}`,
      )

      // �?只返回状态，不触�?doSignout
      return {
        shouldForceQuit: true,
        revokeReason,
      }
    }

    return {
      shouldForceQuit: false,
    }
  }

  /**
   * @description CRUD read
   */
  async read(id: string) {
    return (await this.appMonitorUserBasicRepo.readById(id)).populate([{ path: WalnutDBVirtualName.DEVICE, select: 'deviceId deviceName deviceInfo locationInfo ip' }, { path: WalnutDBVirtualName.USER, select: '_id userName' }])
  }

  /**
   * @description monitor list, support device/user info and filter
   */
  async list(params: AppMonitorUserDTOListRequest) {
  // 1. 构建 lookup 阶段
    const lookupStages: PipelineStage[] = [
    // Device lookup
      {
        $lookup: {
          from: WalnutDBCollectionName.DEVICE,
          let: { deviceIdLocal: '$deviceId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$deviceId', '$$deviceIdLocal'] } } },
            {
              $project: {
                '_id': 0,
                'deviceInfo.os': 1,
                'deviceInfo.browser': 1,
                'deviceInfo.type': 1,
                'ip': 1,
                'locationInfo.country': 1,
              },
            },
          ],
          as: 'populated_device',
        },
      },
      {
        $addFields: {
          populated_device: { $arrayElemAt: ['$populated_device', 0] },
        },
      },

      // User lookup
      {
        $lookup: {
          from: WalnutDBCollectionName.USER,
          let: { userIdLocal: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$userIdLocal'] } } },
            { $project: { _id: 0, userName: 1 } },
          ],
          as: 'populated_user',
        },
      },
      {
        $addFields: {
          populated_user: { $arrayElemAt: ['$populated_user', 0] },
        },
      },
    ]

    // 2. 准备基于 lookup 结果�?Match Conditions
    // 这部分逻辑保持不变，依然很有必�?
    const matchConditions: Record<string, any> = {}
    const { ip, country, os, browser, userName } = params.query
    if (ip)
      matchConditions['populated_device.ip'] = { $regex: ip, $options: 'i' }
    if (!isNil(country))
      matchConditions['populated_device.locationInfo.country'] = { $regex: country, $options: 'i' }
    if (!isNil(os))
      matchConditions['populated_device.deviceInfo.os'] = { $regex: os, $options: 'i' }
    if (!isNil(browser))
      matchConditions['populated_device.deviceInfo.browser'] = { $regex: browser, $options: 'i' }
    if (!isNil(userName))
      matchConditions['populated_user.userName'] = { $regex: userName, $options: 'i' }

    // 3. 组装 Extra Pipeline
    // �?Lookup 和后续的 Match 组合在一�?
    const extraPipeline: PipelineStage[] = [
      ...lookupStages,
      ...(Object.keys(matchConditions).length > 0 ? [{ $match: matchConditions }] : []),
    ]

    // 4. 使用统一工具生成完整 Pipeline
    // 注意：这�?sortAfter 应该�?true，因为排序通常是在 populate 之后进行
    const pipeline = buildListPipelineFromRequest(params, extraPipeline, true)

    // 5. 执行
    const [result] = await this.appMonitorUserBasicRepo.DBModel.aggregate<{
      data: IAppMonitorUserDocument[]
      total: number
    }>(pipeline)

    // 6. 返回
    return result
  }
}
