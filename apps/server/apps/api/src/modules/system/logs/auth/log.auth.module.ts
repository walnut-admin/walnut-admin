import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLogOperateModule } from '../operate/log.operate.module'

import { SysLogAuthEntity } from './entity/log-auth.entity'
import { SysLogAuthBasicRepository } from './log.auth.basic.repository'
import { SysLogAuthController } from './log.auth.controller'
import { SysLogAuthService } from './log.auth.service'
import { SysLogAuthRepoModule } from './repo/log.auth.repo.module'
import { SysLogAuthSharedModule } from './shared/log.auth.shared.module'

/**
 * B8 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLogAuthEntity], WalnutPGConnectionName),
    SysLogOperateModule,
    SysLogAuthRepoModule,
    SysLogAuthSharedModule,
  ],
  controllers: [SysLogAuthController],
  providers: [SysLogAuthBasicRepository, SysLogAuthService],
  exports: [SysLogAuthService],
})
export class SysLogAuthModule {}
