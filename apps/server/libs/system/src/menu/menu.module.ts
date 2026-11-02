import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleSharedModule } from '../locale/shared/locale.shared.module'
import { SysMenuEntity } from './entity/menu.entity'
import { SysMenuBasicRepository } from './menu.basic.repository'
import { SysMenuService } from './menu.service'
import { sysMenuRecoverableProvider } from './repo/menu.recoverer'
import { SysMenuRepositoryModule } from './repo/menu.repo.module'
import { SysMenuSharedModule } from './shared/menu.shared.module'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysMenuEntity], WalnutPGConnectionName),
    SysMenuRepositoryModule,
    SysMenuSharedModule,
    SysLocaleSharedModule,
  ],
  controllers: [],
  providers: [SysMenuBasicRepository, SysMenuService, sysMenuRecoverableProvider],
  exports: [SysMenuService],
})
export class SysMenuModule {}
