import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SharedScopeResolverModule } from '@/modules/shared/scopeResolver/scope-resolver.module'
import { SysRoleMenuEntity } from '../entity/role-menu.entity'
import { SysRoleEntity } from '../entity/role.entity'
import { SysRoleSharedService } from './role.shared.service'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SysRoleEntity, SysRoleMenuEntity],
      WalnutPGConnectionName,
    ),
    SharedScopeResolverModule,
  ],
  controllers: [],
  providers: [SysRoleSharedService],
  exports: [SysRoleSharedService],
})
export class SysRoleSharedModule {}
