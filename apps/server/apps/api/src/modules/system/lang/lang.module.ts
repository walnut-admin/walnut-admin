import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysLangBasicRepository } from './lang.basic.repository'
import { SysLangController } from './lang.controller'
import { SysLangService } from './lang.service'
import { SysLangRepoModule } from './repo/lang.repo.module'
import { SysLangSchema } from './schema/lang.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_LANG, schema: SysLangSchema }],
      WalnutDBConnectionName,
    ),
    SysLangRepoModule,
  ],
  controllers: [SysLangController],
  providers: [SysLangBasicRepository, SysLangService],
  exports: [SysLangService],
})
export class SysLangModule {}
