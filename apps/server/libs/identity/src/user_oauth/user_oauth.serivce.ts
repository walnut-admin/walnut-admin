import { Injectable } from '@nestjs/common'

import { SysUserOauthEntity } from './entity/user-oauth.entity'
import { SysUserOAuthRepositoryService } from './repo/user_oauth.repo.service'

/**
 * B7a 迁移：Mongo model 直持 → SysUserOAuthRepositoryService（PG DataSource）。
 * `model.exists(dto)` 的「存在即静默跳过」语义原样保留。
 */
@Injectable()
export class SysUserOauthService {
  constructor(
    private readonly sysUserOAuthRepoService: SysUserOAuthRepositoryService,
  ) {}

  async create(dto: Partial<SysUserOauthEntity>) {
    const isExisted = await this.sysUserOAuthRepoService.existsByFields(dto)

    if (isExisted)
      return

    return this.sysUserOAuthRepoService.createByFields(dto)
  }
}
