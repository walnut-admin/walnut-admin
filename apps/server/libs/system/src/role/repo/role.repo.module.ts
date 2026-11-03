import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysRoleDeptEntity } from '../entity/role-dept.entity'
import { SysRoleMenuEntity } from '../entity/role-menu.entity'
import { SysRoleEntity } from '../entity/role.entity'
import { SysRoleRepoService } from './role.repo.service'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 * SysRoleRepoService 的 populate 批查跨 sys_role / sys_role_menu / sys_menu 三表，
 * 三个实体都在此注册；数据权限二期批 1 追加 sys_role_dept（CUSTOM 部门清单）。
 *
 * 模块保持 @Global —— data-scope / role / role.shared 等消费方 > 1，判据 ①b 登记
 * （repo-global.drift.spec.ts）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [SysRoleEntity, SysRoleMenuEntity, SysRoleDeptEntity],
      WalnutPGConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysRoleRepoService],
  exports: [SysRoleRepoService],
})
export class SysRoleRepoModule {}
