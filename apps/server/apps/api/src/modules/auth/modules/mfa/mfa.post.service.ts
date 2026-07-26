import { Injectable } from '@nestjs/common'
import { registerAfterCommitHook } from '@walnut-server/db'
import { ClientSession } from 'mongoose'
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
   * @param dbSession - transaction session (optional)
   */
  async handlePostVerification(
    trusted: boolean,
    jti: string,
    sessionId: string,
    userId: string,
    deviceId: string,
    dbSession: ClientSession,
  ) {
    // update user device trusted status (in transaction)
    await this.sysUserDeviceSharedService.updateTrustedStatusForUserDevice(
      userId,
      deviceId,
      trusted,
      dbSession,
    )

    // set temporary cache for guard use (out of transaction)
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.setVerifiedCache(userId, deviceId)
    })

    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(jti, deviceId, sessionId, dbSession)

    return newAccessToken
  }
}
