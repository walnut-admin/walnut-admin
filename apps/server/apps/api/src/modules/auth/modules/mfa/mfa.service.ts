import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { SysUserMfaSharedService, SysUserSharedService } from '@walnut-server/identity'
import { AuthMfaVerifyDTO } from './mfa.dto'
import { AuthMfaPostVerificationService } from './mfa.post.service'

/**
 * B7b 归一：mfa 状态读写腿（sys_user_mfa）与 user.mfaSetup 写腿、refresh 轮换
 * 同为 PG —— 双句柄（em + dbSession）收成单 em。
 */
@Injectable()
export class AuthMfaService {
  constructor(
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserMfaDeviceSharedService: SysUserMfaSharedService,
    private readonly authMfaPostVerificationService: AuthMfaPostVerificationService,
  ) { }

  /**
   * @description get mfa available methods for user
   */
  async getMfaStatus(userId: string, deviceId: string, em?: EntityManager) {
    return this.sysUserMfaDeviceSharedService.getCurrentUserMfaSetupStatus(userId, deviceId, em)
  }

  /**
   * @description check from sys_user_mfa_device if user has enabled mfa
   * if user has enabled mfa, return same result as sign in
   */
  async verifyMfaStatus(jti: string, dto: AuthMfaVerifyDTO, userId: string, sessionId: string, deviceId: string, em?: EntityManager) {
    // P2-24：就绪判据是用户维度（类型集合跨设备去重），deviceId 只用于后续 post-verification
    const verified = await this.sysUserMfaDeviceSharedService.getIsCurrentUserMfaVerified(userId, em)

    if (!verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    // update user mfa setup status
    await this.sysUserSharedService.updateMfaStatus(userId, verified, em)

    // post verification
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, sessionId, userId, deviceId, em)
  }
}
