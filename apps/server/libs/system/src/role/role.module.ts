import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysRoleMenuEntity } from './entity/role-menu.entity'

import { SysRoleEntity } from './entity/role.entity'
import { sysRoleRecoverableProvider } from './repo/role.recoverer'
import { SysRoleRepoModule } from './repo/role.repo.module'
import { SysRoleBasicRepository } from './role.basic.repository'
import { SysRoleService } from './role.service'
import { SysRoleSharedModule } from './shared/role.shared.module'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysRoleEntity, SysRoleMenuEntity], WalnutPGConnectionName),
    SysRoleRepoModule,
    SysRoleSharedModule,
  ],
  controllers: [],
  providers: [SysRoleBasicRepository, SysRoleService, sysRoleRecoverableProvider],
  exports: [SysRoleService, SysRoleSharedModule],
})
export class SysRoleModule {}
