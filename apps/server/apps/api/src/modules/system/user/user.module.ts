import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysUserDeviceSharedModule } from '../user_device/shared/user_device.shared.module'
import { SysUserMfaSharedModule } from '../user_mfa/shared/user_mfa.shared.module'
import { SysUserController } from './controllers/user.controller'
import { SysUserMeController } from './controllers/user.me.controller'
import { SysUserRepositoryModule } from './repo/user.repo.module'
import { SysUserSchema } from './schema/user.schema'
import { SysUserCrudService } from './services/user.crud.service'
import { SysUserMeService } from './services/user.me.service'
import { SysUserSharedModule } from './shared/user.shared.module'
import { SysUserBasicRepository } from './user.basic.repository'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER, schema: SysUserSchema }],
      WalnutDBConnectionName,
    ),
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
