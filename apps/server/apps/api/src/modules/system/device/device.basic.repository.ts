import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysDeviceDocument,
  ISysDeviceModel,
} from './schema/device.schema'

@Injectable()
export class SysDeviceBasicRepository extends WalnutAdminCommonBasicRepository<ISysDeviceDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DEVICE)
    readonly dbModel: ISysDeviceModel,
  ) {
    super(dbModel)
  }
}
