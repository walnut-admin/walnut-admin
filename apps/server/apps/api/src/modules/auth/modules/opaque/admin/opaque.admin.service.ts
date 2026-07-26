import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { ClientSession } from 'mongoose'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { AuthSignoutService } from '../../signout/signout.service'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'
import { AuthOpaqueFinishChangePasswordForAdminDTO, AuthOpaqueStartChangePasswordForAdminDTO } from '../dto/opaque.dto'

/**
 * OPAQUE (Oblivious Pseudorandom Function) authentication service
 * Implements password-authenticated key exchange protocol that never exposes passwords to the server
 */
@Injectable()
export class AuthOpaqueAdminService {
  private readonly logger = new Logger(AuthOpaqueAdminService.name)

  constructor(
    private readonly authOpaqueCoreService: AuthOpaqueCoreService,
    private readonly userRepo: SysUserRepositoryService,
    private readonly userIdentityRepo: SysUserIdentityRepositoryService,
    private readonly signoutService: AuthSignoutService,
  ) {}

  async startChangePassword(dto: AuthOpaqueStartChangePasswordForAdminDTO) {
    const user = await this.userRepo.findUserByUserId(dto._id.toString())

    if (!user) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.authOpaqueCoreService.startChangePassword(user.userName, dto.start)
  }

  async finishChangePassword(dto: AuthOpaqueFinishChangePasswordForAdminDTO, dbSession: ClientSession) {
    const user = await this.userRepo.findUserByUserId(dto._id.toString())

    if (!user) {
      throw new WalnutAdminExceptionBadRequest()
    }

    await this.authOpaqueCoreService.finishChangePassword(user.userName, dto.finish, dbSession)

    await this.signoutService.doSignout(user._id.toString(), { trigger: 'security-policy', revokeReason: 'updatePass' }, dbSession)

    return true
  }

  async clearPassword(userId: string, dbSession: ClientSession) {
    // Delete password identity from user_identity table
    const identity = await this.userIdentityRepo.findByUserIdTypeAndPurpose(
      userId,
      'password',
      'login',
      dbSession,
    )
    if (identity) {
      await this.userIdentityRepo.deleteByUserIdTypeAndPurpose(
        userId,
        'password',
        'login',
        dbSession,
      )
    }
    return true
  }
}
