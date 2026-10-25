import type { ClientSession } from 'mongoose'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserMfaSharedService } from '@/modules/system/user_mfa/shared/user_mfa.shared.service'
import { AuthMfaVerifyDTO } from './mfa.dto'
import { AuthMfaPostVerificationService } from './mfa.post.service'

@Injectable()
export class AuthMfaService {
  constructor(
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserMfaDeviceSharedService: SysUserMfaSharedService,
    private readonly authMfaPostVerificationService: AuthMfaPostVerificationService,
  ) { }

  /**
   * @description get mfa available methods for user（mfa 表 7b 迁移前仍走 Mongo session）
   */
  async getMfaStatus(userId: string, deviceId: string, dbSession: ClientSession) {
    return this.sysUserMfaDeviceSharedService.getCurrentUserMfaSetupStatus(userId, deviceId, dbSession)
  }

  /**
   * @description check from sys_user_mfa_device if user has enabled mfa
   * if user has enabled mfa, return same result as sign in
   *
   * B7a 签名适配：mfa 状态读写腿仍走 ctx.dbSession（7b 迁移），user.mfaSetup 写腿
   * 已迁 PG —— 双句柄并传（em + dbSession），7c 归一。
   */
  async verifyMfaStatus(jti: string, dto: AuthMfaVerifyDTO, userId: string, sessionId: string, deviceId: string, em: EntityManager, dbSession: ClientSession) {
    const verified = await this.sysUserMfaDeviceSharedService.getIsCurrentUserMfaVerified(userId, deviceId, dbSession)

    if (!verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    // update user mfa setup status
    await this.sysUserSharedService.updateMfaStatus(userId, verified, em)

    // post verification
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, sessionId, userId, deviceId, em, dbSession)
  }
}
