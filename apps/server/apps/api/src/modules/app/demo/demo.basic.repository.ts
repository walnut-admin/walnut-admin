import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { IAppDemoDocument, IAppDemoModel } from './schema/demo.schema'

@Injectable()
export class AppDemoBasicRepository extends WalnutAdminCommonBasicRepository<IAppDemoDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_DEMO)
    readonly dbModel: IAppDemoModel,
  ) {
    super(dbModel)
  }
}
