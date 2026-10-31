import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysUserOauthEntity } from './entity/user-oauth.entity'
import { SysUserOAuthRepositoryModule } from './repo/user_oauth.repo.module'
import { SysUserOAuthBasicRepository } from './user_oauth.basic.repository'
import { SysUserOauthService } from './user_oauth.serivce'

/**
 * B7a 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserOauthEntity], WalnutPGConnectionName),
    SysUserOAuthRepositoryModule,
  ],
  // 批 6：controller 留 app（identity-http.module.ts）
  controllers: [],
  providers: [SysUserOAuthBasicRepository, SysUserOauthService],
  exports: [SysUserOauthService],
})
export class SysUserOauthModule {}
