import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysDictTypeDocument,
  ISysDictTypeModel,
} from './schema/dictType.schema'

@Injectable()
export class SysDictTypeBasicRepository extends WalnutAdminCommonBasicRepository<ISysDictTypeDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DICT_TYPE)
    readonly dbModel: ISysDictTypeModel,
  ) {
    super(dbModel)
  }
}
