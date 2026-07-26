import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysLogOperateModule } from '../operate/log.operate.module'

import { SysLogAuthBasicRepository } from './log.auth.basic.repository'
import { SysLogAuthController } from './log.auth.controller'
import { SysLogAuthService } from './log.auth.service'
import { SysLogAuthRepoModule } from './repo/log.auth.repo.module'
import { SysLogAuthSchema } from './schema/log.auth.schema'
import { SysLogAuthSharedModule } from './shared/log.auth.shared.module'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_LOG_AUTH,
          schema: SysLogAuthSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysLogOperateModule,
    SysLogAuthRepoModule,
    SysLogAuthSharedModule,
  ],
  controllers: [SysLogAuthController],
  providers: [SysLogAuthBasicRepository, SysLogAuthService],
  exports: [SysLogAuthService],
})
export class SysLogAuthModule {}
