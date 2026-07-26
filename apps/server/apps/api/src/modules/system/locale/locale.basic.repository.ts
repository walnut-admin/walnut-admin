import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysLocaleDocument, ISysLocaleModel } from './schema/locale.schema'

@Injectable()
export class SysLocaleBasicRepository extends WalnutAdminCommonBasicRepository<ISysLocaleDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOCALE)
    readonly dbModel: ISysLocaleModel,
  ) {
    super(dbModel)
  }
}
