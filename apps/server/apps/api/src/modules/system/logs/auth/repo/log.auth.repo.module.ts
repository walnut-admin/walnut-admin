import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysLogAuthSchema } from '../schema/log.auth.schema'
import { SysLogAuthRepoService } from './log.auth.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LOG_AUTH, schema: SysLogAuthSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLogAuthRepoService],
  exports: [SysLogAuthRepoService],
})
export class SysLogAuthRepoModule {}
