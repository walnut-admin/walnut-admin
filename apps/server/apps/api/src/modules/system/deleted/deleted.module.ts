import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'

import { SysDeletedBasicRepository } from './deleted.basic.repository'
import { SysDeletedController } from './deleted.controller'
import { SysDeletedService } from './deleted.service'
import { SysDeletedRepoModule } from './repo/deleted.repo.module'
import { SysDeletedSchema } from './schema/deleted.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_DELETED,
          schema: SysDeletedSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysDeletedRepoModule,
  ],
  controllers: [SysDeletedController],
  providers: [SysDeletedBasicRepository, SysDeletedService],
  exports: [SysDeletedService],
})
export class SysDeletedModule {}
