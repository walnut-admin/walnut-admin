import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDictDataBasicRepository } from '../dictData/dictData.basic.repository'

import { SysDictDataEntity } from '../dictData/entity/dict-data.entity'
import { SysDictTypeBasicRepository } from './dictType.basic.repository'
import { SysDictTypeService } from './dictType.service'
import { SysDictTypeEntity } from './entity/dict-type.entity'
import { sysDictTypeRecoverableProvider } from './repo/dict-type.recoverer'

/**
 * B3 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 * getByType 跨 dict data 取数（populate → findActiveByTypeId），SysDictDataEntity 与其
 * repo 一并在本模块装配。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SysDictTypeEntity, SysDictDataEntity],
      WalnutPGConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysDictTypeBasicRepository, SysDictDataBasicRepository, SysDictTypeService, sysDictTypeRecoverableProvider],
  exports: [SysDictTypeService],
})
export class SysDictTypeModule {}
