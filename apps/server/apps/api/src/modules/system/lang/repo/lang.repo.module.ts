import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysLangSchema } from '../schema/lang.schema'
import { SysLangRepoService } from './lang.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LANG, schema: SysLangSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLangRepoService],
  exports: [SysLangRepoService],
})
export class SysLangRepoModule {}
