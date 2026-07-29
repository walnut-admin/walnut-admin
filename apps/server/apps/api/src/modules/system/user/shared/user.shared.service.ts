import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import type { ClientSession } from 'mongoose'
import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstRoleMode } from '@walnut/contract'
import { WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminExceptionUserBannedToSignin } from '@walnut-server/exceptions/business/auth'
import { omit } from 'lodash'
import { Types } from 'mongoose'
import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { SysUserDeviceSharedService } from '../../user_device/shared/user_device.shared.service'
import { SysUserDTO } from '../dto/user.dto'
import { SysUserRepositoryService } from '../repo/user.repo.service'
import { ISysUserDocument } from '../schema/user.schema'

@Injectable()
export class SysUserSharedService {
  private readonly logger = new Logger(SysUserSharedService.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly scopeResolverService: SharedScopeResolverService,
    private readonly tokenService: AppTokenService,
    private readonly sysUserDeviceSharedService: SysUserDeviceSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
  ) { }

  /**
   * @description update mfa status for user
   * Semantic wrapper around findUserByIdAndUpdate for MFA status updates
   */
  async updateMfaStatus(userId: string, mfaSetup: boolean, dbSession: ClientSession) {
    return this.sysUserRepoService.findUserByIdAndUpdate(userId, { mfaSetup }, dbSession)
  }

  // sign up for non exist user
  async createForAuthUser(payload: Partial<SysUserDTO>, dbSession?: ClientSession) {
    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    return this.sysUserRepoService.createUser({
      ...omit(payload, ['populated_roles_list']),
      userName: payload.userName ?? `user_${randomBytes(4).toString('hex').slice(2, 8)}`,
      roles: [new Types.ObjectId(functionalRole.defaultRole)],
      currentRole: new Types.ObjectId(functionalRole.defaultRole),
      roleMode: WalnutAdminConstRoleMode.SWITCH,
    }, dbSession)
  }

  /**
   * @description check user status, include role status, throw exception if banned
   */
  async checkUserAndRoleStatus(user: ISysUserDocument) {
    const { populated_roles_list, status, currentRole, roleMode } = user

    // user banned to signin
    if (!status) {
      throw new WalnutAdminExceptionUserBannedToSignin()
    }

    // if no role is populated
    // this means all role bind to this user has been banned
    if (populated_roles_list?.length === 0) {
      throw new WalnutAdminExceptionUserBannedToSignin()
    }

    // combine
    if (roleMode === WalnutAdminConstRoleMode.COMBINE) {
      // role combine mode
      // if no role has true status, also banned to sign in
      if (!populated_roles_list?.some(i => i.status)) {
        throw new WalnutAdminExceptionUserBannedToSignin()
      }
    }

    // switch
    if (roleMode === WalnutAdminConstRoleMode.SWITCH) {
      const currentRoleFromList = populated_roles_list?.find(i => i._id.toString() === currentRole.toString())
      if (currentRoleFromList) {
        if (!currentRoleFromList.status) {
          throw new WalnutAdminExceptionUserBannedToSignin()
        }
      }
      else {
        this.logger.log('Cannot find current role in `populated_roles_list` which should not happen')
        this.logger.log('This case should not happen, some logic is wrong, need to check')
      }
    }
  }

  /**
   * @description user change role
   */
  async switchRole(userId: string, roleId: string) {
    const user = await this.sysUserRepoService.findUserByUserId(userId)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    const effectiveRoleMode = this.scopeResolverService.resolve(functionalRole, user)

    if (effectiveRoleMode === WalnutAdminConstRoleMode.COMBINE) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // roleId should be in `user.roles`
    if (!user.roles.map(String).includes(roleId)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.sysUserRepoService.findUserByIdAndUpdate(userId, {
      currentRole: new Types.ObjectId(roleId),
    })
  }

  /**
   * @description user change role mode
   */
  async switchRoleMode(userId: string, roleMode: IWalnutAdminConstRoleMode) {
    const user = await this.sysUserRepoService.findUserByUserId(userId)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return this.sysUserRepoService.findUserByIdAndUpdate(userId, { roleMode })
  }

  /**
   * @description get access token payload when user existed
   */
  async getAccessTokenPayloadWhenUserExisted(payload: ISysUserDocument, deviceId: string) {
    // Step 1 - get user with role infos
    const user = await this.getUserWithPopulatedRoles(payload)

    // Step 2 - check user status
    await this.checkUserAndRoleStatus(user)

    // Step 2.5 - get user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(user._id.toString(), deviceId)

    // Step 3 - construct access token payload
    return this.tokenService.getJwtAccessTokenPayload(user, { isTrusted })
  }

  /**
   * @description get access token payload after automatic sign up for non exist user
   */
  async getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser(payload: Partial<SysUserDTO>, deviceId: string, dbSession?: ClientSession) {
    // Step 1 - sign up for the non exist user
    const user = await this.createForAuthUser(payload, dbSession)

    // Step 2 - populate role infos
    const _user = await this.getUserWithPopulatedRoles(user)

    // Step 2.5 - get user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(_user._id.toString(), deviceId)

    // Step 3 - construct access token payload
    return this.tokenService.getJwtAccessTokenPayload(_user, { isTrusted })
  }

  /**
   * @description get user with populated role through condition
   */
  private async getUserWithPopulatedRoles(user: ISysUserDocument) {
    return user.populate({ path: WalnutDBVirtualName.ROLES_LIST })
  }
}
