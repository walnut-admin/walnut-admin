import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { SysRoleRepoModule } from './repo/role.repo.module'
import { SysRoleBasicRepository } from './role.basic.repository'
import { SysRoleController } from './role.controller'
import { SysRoleService } from './role.service'
import { SysRoleSchema } from './schema/role.schema'
import { SysRoleSharedModule } from './shared/role.shared.module'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_ROLE, schema: SysRoleSchema }],
      WalnutDBConnectionName,
    ),
    SysRoleRepoModule,
    SysRoleSharedModule,
  ],
  controllers: [SysRoleController],
  providers: [SysRoleBasicRepository, SysRoleService],
  exports: [SysRoleService, SysRoleSharedModule],
})
export class SysRoleModule {}
