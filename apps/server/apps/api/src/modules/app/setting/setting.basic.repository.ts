import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import { IAppSettingDocument, IAppSettingModel } from './schema/setting.schema'

@Injectable()
export class AppSettingBasicRepository extends WalnutAdminCommonBasicRepository<IAppSettingDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_SETTING)
    readonly dbModel: IAppSettingModel,
  ) {
    super(dbModel)
  }
}
