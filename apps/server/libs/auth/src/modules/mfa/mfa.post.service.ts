import type { IIdentityMfaPostVerification } from '@walnut-server/identity'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { AppTechCacheMfaService } from '@walnut-server/cache'
import { registerAfterCommitHook } from '@walnut-server/db'
import { SysUserDeviceSharedService } from '@walnut-server/identity'
import { AuthRefreshSharedService } from '../refresh/shared/refresh.shared.service'

@Injectable()
/** 批 6：implements 是端口绑定的编译期守护（libs/identity 只认端口）。 */
export class AuthMfaPostVerificationService implements IIdentityMfaPostVerification {
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

    // revoke-and-insert（2026-10-27）：轮换返回 { accessToken, jti } —— jti 是新 RT 行
    // 的 jti，必须逐层透传给 verify controller 回种 RT_JTI cookie（旧 jti 行已撤销，
    // 不回种新 jti 客户端下次 refresh 必 40102）
    return this.authRefreshSharedService.getNewAccessToken(jti, deviceId, sessionId, em)
  }
}
