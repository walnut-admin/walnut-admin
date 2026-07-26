import { Injectable } from '@nestjs/common'

import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysUserIdentityDocument, ISysUserIdentityModel } from './schema/user_identity.schema'

@Injectable()
export class SysUserIdentityBasicRepository extends WalnutAdminCommonBasicRepository<ISysUserIdentityDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_IDENTITY)
    readonly dbModel: ISysUserIdentityModel,
  ) {
    super(dbModel)
  }
}
