import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysLocaleSchema } from '../schema/locale.schema'
import { SysLocaleRepoService } from './locale.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LOCALE, schema: SysLocaleSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLocaleRepoService],
  exports: [SysLocaleRepoService],
})
export class SysLocaleRepoModule {}
