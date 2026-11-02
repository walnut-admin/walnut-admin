import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysUserIdentityEntity } from './entity/user-identity.entity'
import { SysUserIdentityRepositoryModule } from './repo/user_identity.repo.module'
import { SysUserIdentitySharedModule } from './shared/user_identity.shared.module'
import { SysUserIdentityBasicRepository } from './user_identity.basic.repository'
import { SysUserIdentityService } from './user_identity.service'

/**
 * B7a 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserIdentityEntity], WalnutPGConnectionName),
    SysUserIdentityRepositoryModule,
    SysUserIdentitySharedModule,
  ],
  // 批 6：controller 留 app（identity-http.module.ts）
  controllers: [],
  providers: [SysUserIdentityService, SysUserIdentityBasicRepository],
  exports: [SysUserIdentityService],
})
export class SysUserIdentityModule {}
