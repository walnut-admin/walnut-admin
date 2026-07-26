import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysDictDataDocument,
  ISysDictDataModel,
} from './schema/dictData.schema'

@Injectable()
export class SysDictDataBasicRepository extends WalnutAdminCommonBasicRepository<ISysDictDataDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DICT_DATA)
    readonly dbModel: ISysDictDataModel,
  ) {
    super(dbModel)
  }
}
