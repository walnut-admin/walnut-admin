import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleEntity } from './entity/locale.entity'

import { SysLocaleBasicRepository } from './locale.basic.repository'
import { sysLocaleRecoverableProvider } from './locale.recoverer'
import { SysLocaleService } from './locale.service'
import { LocaleLangIdValidate } from './locale.validate'
import { SysLocaleRepoModule } from './repo/locale.repo.module'
import { SysLocaleSharedModule } from './shared/locale.shared.module'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLocaleEntity], WalnutPGConnectionName),
    SysLocaleRepoModule,
    SysLocaleSharedModule,
  ],
  controllers: [],
  providers: [SysLocaleBasicRepository, SysLocaleService, LocaleLangIdValidate, sysLocaleRecoverableProvider],
  exports: [SysLocaleService, SysLocaleSharedModule],
})
export class SysLocaleModule {}
