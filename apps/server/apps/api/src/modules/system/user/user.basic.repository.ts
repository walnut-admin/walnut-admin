import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysUserDocument, ISysUserModel } from './schema/user.schema'

@Injectable()
export class SysUserBasicRepository extends WalnutAdminCommonBasicRepository<ISysUserDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER)
    readonly dbModel: ISysUserModel,
  ) {
    super(dbModel)
  }
}
