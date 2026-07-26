import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { AuthSignoutModule } from '@/modules/auth/modules/signout/signout.module'
import { SysUserLockSharedModule } from '../user_lock/shared/user_lock.shared.module'
import { SysUserDeviceRepositoryModule } from './repo/user_device.repo.module'
import { SysUserDeviceSchema } from './schema/user_device.schema'
import { SysUserDeviceController } from './user_device.controller'
import { SysUserDeviceService } from './user_device.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_DEVICE, schema: SysUserDeviceSchema }],
      WalnutDBConnectionName,
    ),
    SysUserDeviceRepositoryModule,
    SysUserLockSharedModule,
    AuthSignoutModule,
  ],
  controllers: [SysUserDeviceController],
  providers: [SysUserDeviceService],
  exports: [SysUserDeviceService],
})
export class SysUserDeviceModule {}
