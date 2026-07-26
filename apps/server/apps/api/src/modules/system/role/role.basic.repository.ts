import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysRoleDocument, ISysRoleModel } from './schema/role.schema'

@Injectable()
export class SysRoleBasicRepository extends WalnutAdminCommonBasicRepository<ISysRoleDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_ROLE)
    readonly dbModel: ISysRoleModel,
  ) {
    super(dbModel)
  }
}
