import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysLogOperateSchema } from '../schema/log.operate.schema'
import { SysLogOperateRepoService } from './log.operate.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LOG_OPERATE, schema: SysLogOperateSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLogOperateRepoService],
  exports: [SysLogOperateRepoService],
})
export class SysLogOperateRepoModule {}
