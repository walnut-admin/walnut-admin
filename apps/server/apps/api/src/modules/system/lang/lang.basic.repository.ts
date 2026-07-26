import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysLangDocument, ISysLangModel } from './schema/lang.schema'

@Injectable()
export class SysLangBasicRepository extends WalnutAdminCommonBasicRepository<ISysLangDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LANG)
    readonly dbModel: ISysLangModel,
  ) {
    super(dbModel)
  }
}
