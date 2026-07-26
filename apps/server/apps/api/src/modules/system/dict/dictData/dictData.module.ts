import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysLocaleSharedModule } from '../../locale/shared/locale.shared.module'
import { SysDictDataBasicRepository } from './dictData.basic.repository'
import { SysDictDataController } from './dictData.controller'
import { SysDictDataService } from './dictData.service'
import { SysDictDataSchema } from './schema/dictData.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_DICT_DATA,
          schema: SysDictDataSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysLocaleSharedModule,
  ],
  controllers: [SysDictDataController],
  providers: [SysDictDataBasicRepository, SysDictDataService],
  exports: [SysDictDataService],
})
export class SysDictDataModule {}
