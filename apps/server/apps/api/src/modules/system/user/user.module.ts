import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserDeviceSharedModule } from '../user_device/shared/user_device.shared.module'
import { SysUserMfaSharedModule } from '../user_mfa/shared/user_mfa.shared.module'
import { SysUserController } from './controllers/user.controller'
import { SysUserMeController } from './controllers/user.me.controller'
import { SysUserRoleEntity } from './entity/user-role.entity'
import { SysUserEntity } from './entity/user.entity'
import { SysUserRepositoryModule } from './repo/user.repo.module'
import { SysUserCrudService } from './services/user.crud.service'
import { SysUserMeService } from './services/user.me.service'
import { SysUserSharedModule } from './shared/user.shared.module'
import { SysUserBasicRepository } from './user.basic.repository'

/**
 * B7a 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 * sys_user_role 关联表一并注册 —— junction 读写与 role 侧 populated_usersCount 计数
 * 子查询都走实体引用。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserEntity, SysUserRoleEntity], WalnutPGConnectionName),
    SysUserDeviceSharedModule,
    SysUserSharedModule,
    SysUserRepositoryModule,
    SysUserMfaSharedModule,
  ],
  controllers: [SysUserController, SysUserMeController],
  providers: [
    SysUserBasicRepository,
    SysUserMeService,
    SysUserCrudService,
  ],
  exports: [
    SysUserMeService,
    SysUserCrudService,
  ],
})
export class SysUserModule {}
