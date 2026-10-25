import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLangEntity } from './entity/lang.entity'
import { SysLangBasicRepository } from './lang.basic.repository'
import { SysLangController } from './lang.controller'
import { SysLangService } from './lang.service'
import { SysLangRepoModule } from './repo/lang.repo.module'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLangEntity], WalnutPGConnectionName),
    SysLangRepoModule,
  ],
  controllers: [SysLangController],
  providers: [SysLangBasicRepository, SysLangService],
  exports: [SysLangService],
})
export class SysLangModule {}
