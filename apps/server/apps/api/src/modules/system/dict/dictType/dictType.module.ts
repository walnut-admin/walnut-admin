import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { SysDictTypeBasicRepository } from './dictType.basic.repository'
import { SysDictTypeController } from './dictType.controller'
import { SysDictTypeService } from './dictType.service'
import { SysDictTypeSchema } from './schema/dictType.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_DICT_TYPE,
          schema: SysDictTypeSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [SysDictTypeController],
  providers: [SysDictTypeBasicRepository, SysDictTypeService],
  exports: [SysDictTypeService],
})
export class SysDictTypeModule {}
