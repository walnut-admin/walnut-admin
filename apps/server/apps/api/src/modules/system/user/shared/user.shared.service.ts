import type { EntityManager } from 'typeorm'
import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminExceptionUserBannedToSignin } from '@walnut-server/exceptions/business/auth'
import { omit } from 'lodash'
import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { SysUserDeviceSharedService } from '../../user_device/shared/user_device.shared.service'
import { SysUserDTO } from '../dto/user.dto'
import { SysUserEntity } from '../entity/user.entity'
import { ISysUserPopulated, SysUserRepositoryService } from '../repo/user.repo.service'

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
  async updateMfaStatus(userId: string, mfaSetup: boolean, em?: EntityManager) {
    return this.sysUserRepoService.findUserByIdAndUpdate(userId, { mfaSetup }, em)
  }

  // sign up for non exist user
  async createForAuthUser(payload: Partial<SysUserDTO>, em?: EntityManager) {
    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    // B5 订正脚本落地后 functionalRole.defaultRole 是 role 的 v5 uuid（phase3-plan §5
    // 残留窗口 2）—— PG 侧按 uuid 语义直用，不再有 ObjectId 包装
    return this.sysUserRepoService.createUser({
      ...omit(payload, ['populated_roles_list']),
      userName: payload.userName ?? `user_${randomBytes(4).toString('hex').slice(2, 8)}`,
      roles: [functionalRole.defaultRole],
      currentRole: functionalRole.defaultRole,
      roleMode: WalnutAdminConstRoleMode.SWITCH,
    }, em)
  }

  /**
   * @description check user status, include role status, throw exception if banned
   */
  async checkUserAndRoleStatus(user: SysUserEntity & Partial<ISysUserPopulated>) {
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
      const currentRoleFromList = populated_roles_list?.find(i => i.id === currentRole)
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
    if (!(await this.sysUserRepoService.populatedRolesList(userId)).map(i => i.id).includes(roleId)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.sysUserRepoService.findUserByIdAndUpdate(userId, {
      currentRole: roleId,
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
  async getAccessTokenPayloadWhenUserExisted(payload: SysUserEntity, deviceId: string, em?: EntityManager) {
    // Step 1 - get user with role infos
    const user = await this.getUserWithPopulatedRoles(payload, em)

    // Step 2 - check user status
    await this.checkUserAndRoleStatus(user)

    // Step 2.5 - get user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(user.id, deviceId)

    // Step 3 - construct access token payload
    return this.tokenService.getJwtAccessTokenPayload(user, { isTrusted })
  }

  /**
   * @description get access token payload after automatic sign up for non exist user
   */
  async getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser(payload: Partial<SysUserDTO>, deviceId: string, em?: EntityManager) {
    // Step 1 - sign up for the non exist user
    const user = await this.createForAuthUser(payload, em)

    // Step 2 - populate role infos
    const _user = await this.getUserWithPopulatedRoles(user, em)

    // Step 2.5 - get user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(_user.id, deviceId)

    // Step 3 - construct access token payload
    return this.tokenService.getJwtAccessTokenPayload(_user, { isTrusted })
  }

  /**
   * @description get user with populated role through condition
   * （B7a 起供 refresh.shared 等跨模块消费方复用 —— Mongo 版为实体的 populate 方法）
   */
  async getUserWithPopulatedRoles<T extends SysUserEntity>(user: T, em?: EntityManager) {
    return this.sysUserRepoService.attachPopulatedRoles(user, em)
  }
}
