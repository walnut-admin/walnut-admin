import type { ClientSession } from 'mongoose'
import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { AuthSignoutService } from '../../signout/signout.service'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'
import { AuthOpaqueFinishChangePasswordForAdminDTO, AuthOpaqueStartChangePasswordForAdminDTO } from '../dto/opaque.dto'

/**
 * OPAQUE (Oblivious Pseudorandom Function) authentication service
 * Implements password-authenticated key exchange protocol that never exposes passwords to the server
 *
 * B7a 签名适配：user/identity 腿迁 PG（em = ctx.em）；signout 的 refresh 写腿仍在
 * Mongo（dbSession = ctx.dbSession）—— 双句柄并传，7c 归一。
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
    const user = await this.userRepo.findUserByUserId(dto.id)

    if (!user) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.authOpaqueCoreService.startChangePassword(user.userName!, dto.start)
  }

  async finishChangePassword(dto: AuthOpaqueFinishChangePasswordForAdminDTO, em: EntityManager, dbSession: ClientSession) {
    const user = await this.userRepo.findUserByUserId(dto.id)

    if (!user) {
      throw new WalnutAdminExceptionBadRequest()
    }

    await this.authOpaqueCoreService.finishChangePassword(user.userName!, dto.finish, em)

    await this.signoutService.doSignout(user.id, { trigger: 'security-policy', revokeReason: 'updatePass' }, dbSession)

    return true
  }

  async clearPassword(userId: string, em: EntityManager) {
    // Delete password identity from user_identity table
    const identity = await this.userIdentityRepo.findByUserIdTypeAndPurpose(
      userId,
      'password',
      'login',
      em,
    )
    if (identity) {
      await this.userIdentityRepo.deleteByUserIdTypeAndPurpose(
        userId,
        'password',
        'login',
        em,
      )
    }
    return true
  }
}
