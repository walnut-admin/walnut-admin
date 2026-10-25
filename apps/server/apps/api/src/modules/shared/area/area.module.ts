import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SharedAreaBasicRepository } from './area.basic.repository'
import { SharedAreaController } from './area.controller'
import { SharedAreaService } from './area.service'
import { SharedAreaEntity } from './entity/area.entity'

/**
 * B4 迁移（接线形态同 demo.module，B1 确立）：Mongo forFeature 摘除，换 PG forFeature；
 * service 原先直持 model，随迁移补 SharedAreaBasicRepository（PG）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SharedAreaEntity], WalnutPGConnectionName),
  ],
  controllers: [SharedAreaController],
  providers: [SharedAreaBasicRepository, SharedAreaService],
  exports: [SharedAreaService],
})
export class SharedAreaModule {}
