import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

import { isNil } from 'lodash'
import { AuthRefreshSharedService } from '@/modules/auth/modules/refresh/shared/refresh.shared.service'
import { AuthSignoutService } from '@/modules/auth/modules/signout/signout.service'
import { SysDeviceRepositoryService } from '@/modules/system/device/repo/device.repo.service'
import { SysDeviceSharedService } from '@/modules/system/device/shared/device.shared.service'
import { SysUserDeviceRepositoryService } from '@/modules/system/user_device/repo/user_device.repo.service'
import { AppMonitorUserDTO, AppMonitorUserDTOListRequest } from './dto/user.dto'
import { AppMonitorUserRepositoryService } from './repo/user.repo.service'
import { AppMonitorUserBasicRepository } from './user.basic.repository'

/**
 * B6 迁移：monitor 列表聚合（$lookup device/user + matchConditions）改 basic repo 的
 * JOIN 版 `list()`；populate（read 的 device/user、updateState 的联动手腿）改按业务键
 * 应用层装回。事务句柄 `dbSession` → `em`。B7b 归一：doSignout 的 refresh 写腿亦迁
 * PG —— forceQuit 的双句柄收成单 em。
 */
@Injectable()
export class AppMonitorUserService {
  private readonly logger = new Logger(AppMonitorUserService.name)

  constructor(
    private readonly appMonitorUserBasicRepo: AppMonitorUserBasicRepository,
    private readonly sysUserDeviceRepo: SysUserDeviceRepositoryService,

    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly deviceSharedService: SysDeviceSharedService,
    private readonly deviceRepoService: SysDeviceRepositoryService,

    private readonly appMonitorUserRepoService: AppMonitorUserRepositoryService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description main service to update user state
   */
  async updateState(
    deviceId: string,
    dto: Partial<AppMonitorUserDTO>,
    em: EntityManager,
  ) {
    if (dto.auth === false) {
      dto.userId = null
    }

    // update doc（nil 值剔除原样保留 —— 含 auth:false 时 userId 被置 null 后被剔除的基线行为）
    const doc = await this.appMonitorUserRepoService.findOneAndUpdate(
      { visitorId: dto.visitorId! },
      { deviceId, ...Object.fromEntries(Object.entries(dto).filter(([_, v]) => !isNil(v))) },
      { upsert: true },
      em,
    )

    if (!doc) {
      this.logger.error(`[UpdateState] | monitor user not found: ${dto.visitorId}`)
      return false
    }

    // update user device last active at
    await this.sysUserDeviceRepo.updateUserDeviceLastActiveAt(deviceId, doc.userId?.toString(), em)

    // update device active status
    await this.deviceSharedService.updateDeviceActive(deviceId, !doc.left, em)

    return true
  }

  /**
   * @description force quit through monitorId
   * （B7b 归一：doSignout 的 refresh 写腿迁 PG —— 双句柄收成单 em）
   */
  async forceQuitByMonitorId(id: string, em?: EntityManager) {
    const appMonitor = await this.appMonitorUserRepoService.findByMonitorId(id, em)

    if (appMonitor === null) {
      this.logger.warn(`monitor user not found: ${id}`)
      return false
    }

    return this.signoutService.doSignout(
      appMonitor.userId as string,
      {
        trigger: 'admin-kick',
        deviceId: appMonitor.deviceId as string,
        fingerprint: appMonitor.visitorId,
        isOnline: !appMonitor.left,
      },
      em,
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

      // 只返回状态，不触发 doSignout
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
   * （Mongo 版 populate：device（deviceId/deviceName/deviceInfo/locationInfo/ip）与
   * user（_id/userName）→ PG 侧 device 直接按业务键取行；user 查 sys_user 同源表，
   * ETL 前为空数据窗口（phase3-plan §5））
   */
  async read(id: string) {
    const monitor = await this.appMonitorUserBasicRepo.readById(id)

    const populated_device = monitor.deviceId !== null
      ? await this.deviceRepoService.findDeviceByDeviceId(monitor.deviceId)
      : null
    const populated_user = monitor.userId !== null
      ? await this.appMonitorUserRepoService.findUserBriefById(monitor.userId)
      : null

    return { ...monitor, populated_device, populated_user }
  }

  /**
   * @description monitor list, support device/user info and filter
   * （Mongo 版 $lookup + matchConditions 聚合 → basic repo 的 JOIN 版 list）
   */
  async list(params: AppMonitorUserDTOListRequest) {
    return this.appMonitorUserBasicRepo.list(params)
  }
}
