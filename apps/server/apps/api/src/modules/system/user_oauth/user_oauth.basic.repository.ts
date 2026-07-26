import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminCommonBasicRepository } from '@/common/repository/base.repository'

import {
  ISysUserOAuthDocument,
  ISysUserOAuthModel,
} from './schema/user_oauth.schema'

@Injectable()
export class SysUserOAuthBasicRepository extends WalnutAdminCommonBasicRepository<ISysUserOAuthDocument> {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_OAUTH)
    readonly dbModel: ISysUserOAuthModel,
  ) {
    super(dbModel)
  }
}
