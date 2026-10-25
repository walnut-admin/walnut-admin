import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutDBConnectionName, WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeletedEntity } from '../entity/deleted.entity'
import { SysDeletedSchema } from '../schema/deleted.schema'
import { SysDeletedPgRepoService } from './deleted.repo.pg.service'
import { SysDeletedRepoService } from './deleted.repo.service'
import { SysDeletedPgRecoverRegistry } from './recover-registry'

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
    // PG 版软删仓库的实体注册（autoLoadEntities 通道）
    TypeOrmModule.forFeature([SysDeletedEntity], WalnutPGConnectionName),
  ],
  providers: [SysDeletedRepoService, SysDeletedPgRepoService, SysDeletedPgRecoverRegistry],
  exports: [SysDeletedRepoService, SysDeletedPgRepoService, SysDeletedPgRecoverRegistry],
})
export class SysDeletedRepoModule {}
