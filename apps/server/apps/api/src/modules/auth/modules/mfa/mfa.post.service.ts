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
   * @param em - PG 事务句柄（B7b 归一：user/refresh 写腿同为 PG，单句柄）
   */
  async handlePostVerification(
    trusted: boolean,
    jti: string,
    sessionId: string,
    userId: string,
    deviceId: string,
    em?: EntityManager,
  ) {
    // update user device trusted status
    await this.sysUserDeviceSharedService.updateTrustedStatusForUserDevice(
      userId,
      deviceId,
      trusted,
    )

    // set temporary cache for guard use (out of transaction)
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.setVerifiedCache(userId, deviceId)
    })

    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(jti, deviceId, sessionId, em)

    return newAccessToken
  }
}
