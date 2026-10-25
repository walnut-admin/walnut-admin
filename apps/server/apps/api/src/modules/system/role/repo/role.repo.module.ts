import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysRoleMenuEntity } from '../entity/role-menu.entity'
import { SysRoleEntity } from '../entity/role.entity'
import { SysRoleRepoService } from './role.repo.service'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 * SysRoleRepoService 的 populate 批查跨 sys_role / sys_role_menu / sys_menu 三表，
 * 三个实体都在此注册。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SysRoleEntity, SysRoleMenuEntity],
      WalnutPGConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysRoleRepoService],
  exports: [SysRoleRepoService],
})
export class SysRoleRepoModule {}
