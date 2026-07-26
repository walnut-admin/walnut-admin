import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysDeletedSchema } from '../schema/deleted.schema'
import { SysDeletedRepoService } from './deleted.repo.service'

@Global()
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
  ],
  providers: [SysDeletedRepoService],
  exports: [SysDeletedRepoService],
})
export class SysDeletedRepoModule {}
