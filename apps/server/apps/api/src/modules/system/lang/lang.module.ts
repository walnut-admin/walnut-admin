import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleSharedModule } from '../locale/shared/locale.shared.module'
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
    // P2-17：lang 变更要与 locale 的缓存刷新通道对齐（SYS_LANG_ID_LIST /
    // SYS_LOCALE_MESSAGES 的重算入口在 locale shared）
    SysLocaleSharedModule,
  ],
  controllers: [SysLangController],
  providers: [SysLangBasicRepository, SysLangService],
  exports: [SysLangService],
})
export class SysLangModule {}
