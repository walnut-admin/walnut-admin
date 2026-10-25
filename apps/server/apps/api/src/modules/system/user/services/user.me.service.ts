import type { ClientSession } from 'mongoose'
import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { SysUserMfaSharedService } from '../../user_mfa/shared/user_mfa.shared.service'
import { SysUserMeDTOUpdateProfileRequest } from '../dto/user.me.dto'
import { SysUserRepositoryService } from '../repo/user.repo.service'
import { SysUserSharedService } from '../shared/user.shared.service'

@Injectable()
export class SysUserMeService {
  constructor(
    private readonly sysUserRepoService: SysUserRepositoryService,

    private readonly sysUserMfaSharedService: SysUserMfaSharedService,
    private readonly sysUserSharedService: SysUserSharedService,
  ) { }

  /**
   * @description get user profile
   */
  async getUserProfile(userId: string) {
    const user = await this.sysUserRepoService.findUserByUserId(userId)
    if (!user) {
      return null
    }

    return this.sysUserRepoService.attachPopulatedRoles(user)
  }

  async updateProfile(userId: string, payload: SysUserMeDTOUpdateProfileRequest) {
    return this.sysUserRepoService.findUserByIdAndUpdate(userId, payload)
  }

  // mfa 侧 7b 迁移前仍走 Mongo session（ctx.dbSession），本方法只透传
  async getSecurityTab2Status(userId: string, dbSession: ClientSession) {
    return this.sysUserMfaSharedService.getUserMfaTotalStatus(userId, dbSession)
  }

  /**
   * @description switch role
   */
  async switchRole(userId: string, roleId: string) {
    return this.sysUserSharedService.switchRole(userId, roleId)
  }

  /**
   * @description switch role mode
   */
  async switchRoleMode(userId: string, roleMode: IWalnutAdminConstRoleMode) {
    return this.sysUserSharedService.switchRoleMode(userId, roleMode)
  }
}
