import type { ClientSession } from 'mongoose'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { registerAfterCommitHook } from '@walnut-server/db'
import { SysUserDeviceSharedService } from '@/modules/system/user_device/shared/user_device.shared.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AuthRefreshSharedService } from '../refresh/shared/refresh.shared.service'

@Injectable()
export class AuthMfaPostVerificationService {
  constructor(
    private readonly sysUserDeviceSharedService: SysUserDeviceSharedService,
    private readonly cacheMfaService: AppTechCacheMfaService,
    private readonly authRefreshSharedService: AuthRefreshSharedService,
  ) {}

  /**
   * @description handle post verification for mfa
   * @param trusted - whether device is trusted
   * @param jti - jwt id
   * @param sessionId - session id
   * @param userId - user id
   * @param deviceId - device id
   * @param em - PG 事务句柄（user 读腿，B7a）
   * @param dbSession - Mongo 事务句柄（refresh 写腿，7c 归一）
   */
  async handlePostVerification(
    trusted: boolean,
    jti: string,
    sessionId: string,
    userId: string,
    deviceId: string,
    em: EntityManager,
    dbSession: ClientSession,
  ) {
    // update user device trusted status
    // （B6：user_device 已迁 PG —— 写腿走 PG，MFA 端点事务里的 Mongo session 只再供
    // refresh 侧使用；签名适配，逻辑不动）
    await this.sysUserDeviceSharedService.updateTrustedStatusForUserDevice(
      userId,
      deviceId,
      trusted,
    )

    // set temporary cache for guard use (out of transaction)
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.setVerifiedCache(userId, deviceId)
    })

    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(jti, deviceId, sessionId, em, dbSession)

    return newAccessToken
  }
}
