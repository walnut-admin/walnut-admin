import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'

import { SysLocaleBasicRepository } from './locale.basic.repository'
import { SysLocaleController } from './locale.controller'
import { SysLocaleService } from './locale.service'
import { LocaleLangIdValidate } from './locale.validate'
import { SysLocaleRepoModule } from './repo/locale.repo.module'
import { SysLocaleSchema } from './schema/locale.schema'
import { SysLocaleSharedModule } from './shared/locale.shared.module'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LOCALE, schema: SysLocaleSchema }],
      WalnutDBConnectionName,
    ),
    SysLocaleRepoModule,
    SysLocaleSharedModule,
  ],
  controllers: [SysLocaleController],
  providers: [SysLocaleBasicRepository, SysLocaleService, LocaleLangIdValidate],
  exports: [SysLocaleService, SysLocaleSharedModule],
})
export class SysLocaleModule {}
