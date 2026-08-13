import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutDBInjectModel, WalnutDBModelName, WalnutDBVirtualName } from '@walnut-server/db'
import { ClientSession } from 'mongoose'
import { SysUserMfaSharedService } from '../../user_mfa/shared/user_mfa.shared.service'
import { SysUserMeDTOUpdateProfileRequest } from '../dto/user.me.dto'
import { ISysUserModel } from '../schema/user.schema'
import { SysUserSharedService } from '../shared/user.shared.service'

@Injectable()
export class SysUserMeService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER)
    private readonly SysUserModel: ISysUserModel,

    private readonly sysUserMfaSharedService: SysUserMfaSharedService,
    private readonly sysUserSharedService: SysUserSharedService,
  ) { }

  /**
   * @description get user profile
   */
  async getUserProfile(userId: string) {
    return this.SysUserModel.findById(userId).populate({ path: WalnutDBVirtualName.ROLES_LIST })
  }

  async updateProfile(userId: string, payload: SysUserMeDTOUpdateProfileRequest) {
    return this.SysUserModel.findByIdAndUpdate(userId, payload, { returnDocument: 'after' })
  }

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
