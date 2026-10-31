import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleEntity } from '../../locale/entity/locale.entity'
import { SysLangEntity } from '../entity/lang.entity'
import { SysLangRepoService } from './lang.repo.service'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 * SysLangRepoService 的两条聚合重写跨 lang/locale 两表，两个实体都在此注册。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SysLangEntity, SysLocaleEntity],
      WalnutPGConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysLangRepoService],
  exports: [SysLangRepoService],
})
export class SysLangRepoModule {}
