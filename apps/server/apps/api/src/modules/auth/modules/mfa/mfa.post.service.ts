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
    // （B7c 归一：trusted 写腿收进同一 PG 事务 —— 与 verify 后的 refresh 轮换同提交/同回滚）
    await this.sysUserDeviceSharedService.updateTrustedStatusForUserDevice(
      userId,
      deviceId,
      trusted,
      em,
    )

    // set temporary cache for guard use (out of transaction)
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.setVerifiedCache(userId, deviceId)
    })

    // P0-1：presentedEncryptedToken 传 undefined —— MFA/TOTP/WebAuthn verify 端点不走
    // JwtRefreshGuard，客户端只持 RT_JTI cookie、无入口密文快照可比。跳过呈献比对，
    // 重放拦截由 refresh 端点承担（verify 链本身有 MFA verified 缓存 + 一次性凭证兜底）
    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(jti, deviceId, sessionId, undefined, em)

    return newAccessToken
  }
}
