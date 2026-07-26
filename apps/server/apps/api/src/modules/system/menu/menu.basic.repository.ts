import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysMenuDocument, ISysMenuModel } from './schema/menu.schema'

@Injectable()
export class SysMenuBasicRepository extends WalnutAdminCommonBasicRepository<ISysMenuDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_MENU)
    readonly dbModel: ISysMenuModel,
  ) {
    super(dbModel)
  }
}
