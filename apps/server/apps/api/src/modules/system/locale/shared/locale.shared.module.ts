import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysLocaleBasicRepository } from '../locale.basic.repository'
import { SysLocaleSchema } from '../schema/locale.schema'
import { SysLocaleSharedService } from './locale.shared.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LOCALE, schema: SysLocaleSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLocaleBasicRepository, SysLocaleSharedService],
  exports: [SysLocaleSharedService],
})
export class SysLocaleSharedModule {}
