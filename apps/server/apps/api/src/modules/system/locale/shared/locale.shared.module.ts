import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleEntity } from '../entity/locale.entity'
import { SysLocaleBasicRepository } from '../locale.basic.repository'
import { SysLocaleSharedService } from './locale.shared.service'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLocaleEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysLocaleBasicRepository, SysLocaleSharedService],
  exports: [SysLocaleSharedService],
})
export class SysLocaleSharedModule {}
