import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleEntity } from '../entity/locale.entity'
import { SysLocaleRepoService } from './locale.repo.service'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLocaleEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysLocaleRepoService],
  exports: [SysLocaleRepoService],
})
export class SysLocaleRepoModule {}
