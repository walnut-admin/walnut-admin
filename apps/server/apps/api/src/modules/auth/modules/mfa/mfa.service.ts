import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions/base.exception'
import { ClientSession } from 'mongoose'
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
   * @description get mfa available methods for user
   */
  async getMfaStatus(userId: string, deviceId: string, dbSession: ClientSession) {
    return this.sysUserMfaDeviceSharedService.getCurrentUserMfaSetupStatus(userId, deviceId, dbSession)
  }

  /**
   * @description check from sys_user_mfa_device if user has enabled mfa
   * if user has enabled mfa, return same result as sign in
   */
  async verifyMfaStatus(jti: string, dto: AuthMfaVerifyDTO, userId: string, sessionId: string, deviceId: string, dbSession: ClientSession) {
    const verified = await this.sysUserMfaDeviceSharedService.getIsCurrentUserMfaVerified(userId, deviceId, dbSession)

    if (!verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    // update user mfa setup status
    await this.sysUserSharedService.updateMfaStatus(userId, verified, dbSession)

    // post verification
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, sessionId, userId, deviceId, dbSession)
  }
}
