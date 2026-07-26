import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'

import { SysUserOauthDto } from './dto/user_oauth.dto'
import { ISysUserOAuthModel } from './schema/user_oauth.schema'
import { SysUserOAuthBasicRepository } from './user_oauth.basic.repository'

@Injectable()
export class SysUserOauthService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_OAUTH)
    private readonly sysUserOauthModel: ISysUserOAuthModel,
    private readonly sysUserOauthBasicRepo: SysUserOAuthBasicRepository,
  ) {}

  async create(dto: Partial<SysUserOauthDto>) {
    const isExisted = await this.sysUserOauthModel.exists(dto)

    if (isExisted)
      return

    return this.sysUserOauthBasicRepo.create(dto)
  }
}
