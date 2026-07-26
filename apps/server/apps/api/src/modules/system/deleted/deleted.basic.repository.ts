import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { ISysDeletedDocument, ISysDeletedModel } from './schema/deleted.schema'

@Injectable()
export class SysDeletedBasicRepository extends WalnutAdminCommonBasicRepository<ISysDeletedDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DELETED)
    readonly dbModel: ISysDeletedModel,
  ) {
    super(dbModel)
  }
}
