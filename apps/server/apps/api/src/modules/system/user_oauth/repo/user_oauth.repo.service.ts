import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession, Types } from 'mongoose'

import { ISysUserOAuthModel } from '../schema/user_oauth.schema'

@Injectable()
export class SysUserOAuthRepositoryService {
  private readonly logger = new Logger(SysUserOAuthRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_OAUTH)
    private readonly UserOAuthModel: ISysUserOAuthModel,
  ) { }

  /**
   * @description find oauth binding by provider and provider id
   */
  async findByProviderAndProviderId(
    provider: string,
    providerId: string,
    dbSession?: ClientSession,
  ) {
    return this.UserOAuthModel
      .findOne({ provider, providerId })
      .session(dbSession!)
      .exec()
  }

  /**
   * @description bind oauth info for user (upsert operation)
   */
  async bindOAuthForUser(userId: string, provider: string, providerId: string, dbSession: ClientSession) {
    return this.UserOAuthModel.findOneAndUpdate({
      userId: new Types.ObjectId(userId),
      provider,
    }, {
      userId: new Types.ObjectId(userId),
      provider,
      providerId,
    }, { returnDocument: 'after', upsert: true }).session(dbSession)
  }
}
