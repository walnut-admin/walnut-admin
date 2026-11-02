import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleSharedModule } from '../../locale/shared/locale.shared.module'
import { SysDictDataBasicRepository } from './dictData.basic.repository'
import { SysDictDataService } from './dictData.service'
import { SysDictDataEntity } from './entity/dict-data.entity'
import { sysDictDataRecoverableProvider } from './repo/dict-data.recoverer'

/**
 * B3 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDictDataEntity], WalnutPGConnectionName),
    SysLocaleSharedModule,
  ],
  controllers: [],
  providers: [SysDictDataBasicRepository, SysDictDataService, sysDictDataRecoverableProvider],
  exports: [SysDictDataService],
})
export class SysDictDataModule {}
