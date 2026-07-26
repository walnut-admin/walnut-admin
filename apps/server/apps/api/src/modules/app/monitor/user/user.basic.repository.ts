import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  IAppMonitorUserDocument,
  IAppMonitorUserModel,
} from './schema/user.schema'

@Injectable()
export class AppMonitorUserBasicRepository extends WalnutAdminCommonBasicRepository<IAppMonitorUserDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_MONITOR_USER)
    readonly dbModel: IAppMonitorUserModel,
  ) {
    super(dbModel)
  }
}
