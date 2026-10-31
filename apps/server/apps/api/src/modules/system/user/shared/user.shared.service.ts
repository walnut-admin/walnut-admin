import type { EntityManager } from 'typeorm'
import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminExceptionUserBannedToSignin } from '@walnut-server/exceptions/business/auth'
import { omit } from 'lodash'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { DataScopeService } from '../../data-scope/data-scope.service'
import { SysUserDeviceSharedService } from '../../user_device/shared/user_device.shared.service'
import { SysUserDTO } from '../dto/user.dto'
import { SysUserEntity } from '../entity/user.entity'
import { ISysUserPopulated, SysUserRepositoryService } from '../repo/user.repo.service'

@Injectable()
export class SysUserSharedService {
  private readonly logger = new Logger(SysUserSharedService.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly tokenService: AppTokenService,
    private readonly sysUserDeviceSharedService: SysUserDeviceSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly dataScopeService: DataScopeService,
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
      ...omit(payload, ['roles_list']),
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
    const { roles_list, status, currentRole, roleMode } = user

    // user banned to signin
    if (!status) {
      throw new WalnutAdminExceptionUserBannedToSignin()
    }

    // if no role is populated
    // this means all role bind to this user has been banned
    if (roles_list?.length === 0) {
      throw new WalnutAdminExceptionUserBannedToSignin()
    }

    // combine
    if (roleMode === WalnutAdminConstRoleMode.COMBINE) {
      // role combine mode
      // if no role has true status, also banned to sign in
      if (!roles_list?.some(i => i.status)) {
        throw new WalnutAdminExceptionUserBannedToSignin()
      }
    }

    // switch
    if (roleMode === WalnutAdminConstRoleMode.SWITCH) {
      const currentRoleFromList = roles_list?.find(i => i.id === currentRole)
      if (currentRoleFromList) {
        if (!currentRoleFromList.status) {
          throw new WalnutAdminExceptionUserBannedToSignin()
        }
      }
      else {
        this.logger.log('Cannot find current role in `roles_list` which should not happen')
        this.logger.log('This case should not happen, some logic is wrong, need to check')
      }
    }
  }

  /**
   * @description user change role
   *
   * P2-19（2026-10-29）：准入判据从 **effective** roleMode 改为用户行值 `role_mode`。
   *
   * effective 值只在 `app.functional.role` 显式配 LOCAL scope 时才跟随行值；零配置
   * 部署（GLOBAL/combinable）下它恒为 COMBINE，旧判据因此对所有用户恒 40000 ——
   * 而 AT payload、permission guard 的 root/visitor 短路都按行值工作，前端角色切换
   * 入口也随之失效。switchRole 是「用户在自己的 junction 角色间切换」，与权限合并
   * 的计算口径无关：行值 switchable + 目标角色在 junction 内即允许，与 token/guard
   * 的判据对齐（`switchRoleMode` 只写行值，本判据下发即生效）。
   */
  async switchRole(userId: string, roleId: string) {
    const user = await this.sysUserRepoService.findUserByUserId(userId)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    if (user.roleMode === WalnutAdminConstRoleMode.COMBINE) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // roleId should be in `user.roles`
    if (!(await this.sysUserRepoService.populatedRolesList(userId)).map(i => i.id).includes(roleId)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    const updated = await this.sysUserRepoService.findUserByIdAndUpdate(userId, {
      currentRole: roleId,
    })

    // 数据权限一期：SWITCH 模式下 currentRole 直接决定描述符（缓存不带 deviceId），
    // 切换后必须失效，否则最长一个 AT TTL 内仍按旧角色过滤
    await this.dataScopeService.invalidateForUser(userId)

    return updated
  }

  /**
   * @description user change role mode
   */
  async switchRoleMode(userId: string, roleMode: IWalnutAdminConstRoleMode) {
    const user = await this.sysUserRepoService.findUserByUserId(userId)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const updated = await this.sysUserRepoService.findUserByIdAndUpdate(userId, { roleMode })

    // 数据权限一期：COMBINE/SWITCH 的解析口径随 roleMode 变化，缓存必须失效
    await this.dataScopeService.invalidateForUser(userId)

    return updated
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
