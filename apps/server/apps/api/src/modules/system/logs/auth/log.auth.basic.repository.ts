import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysLogAuthDocument,
  ISysLogAuthModel,
} from './schema/log.auth.schema'

@Injectable()
export class SysLogAuthBasicRepository extends WalnutAdminCommonBasicRepository<ISysLogAuthDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOG_AUTH)
    readonly dbModel: ISysLogAuthModel,
  ) {
    super(dbModel)
  }
}
