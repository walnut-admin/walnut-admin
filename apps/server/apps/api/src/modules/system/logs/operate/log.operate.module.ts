import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysLogOperateBasicRepository } from './log.operate.basic.repository'
import { SysLogOperateController } from './log.operate.controller'
import { SysLogOperateService } from './log.operate.service'
import { SysLogOperateRepoModule } from './repo/log.operate.repo.module'
import { SysLogOperateSchema } from './schema/log.operate.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_LOG_OPERATE,
          schema: SysLogOperateSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysLogOperateRepoModule,
  ],
  controllers: [SysLogOperateController],
  providers: [SysLogOperateBasicRepository, SysLogOperateService],
  exports: [SysLogOperateService],
})
export class SysLogOperateModule {}
