import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysLogOperateDocument,
  ISysLogOperateModel,
} from './schema/log.operate.schema'

@Injectable()
export class SysLogOperateBasicRepository extends WalnutAdminCommonBasicRepository<ISysLogOperateDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOG_OPERATE)
    readonly dbModel: ISysLogOperateModel,
  ) {
    super(dbModel)
  }
}
