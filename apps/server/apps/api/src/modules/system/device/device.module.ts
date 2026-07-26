import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysUserDeviceSharedModule } from '../user_device/shared/user_device.shared.module'
import { SysDeviceBasicRepository } from './device.basic.repository'
import { SysDeviceController } from './device.controller'
import { SysDeviceService } from './device.service'
import { SysDeviceSettingService } from './device.setting.service'
import { SysDeviceRepositoryModule } from './repo/device.repo.module'
import { SysDeviceSchema } from './schema/device.schema'
import { SysDeviceSharedModule } from './shared/device.shared.module'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_DEVICE, schema: SysDeviceSchema }],
      WalnutDBConnectionName,
    ),
    SysUserDeviceSharedModule,
    SysDeviceSharedModule,
    SysDeviceRepositoryModule,
  ],
  controllers: [SysDeviceController],
  providers: [SysDeviceBasicRepository, SysDeviceService, SysDeviceSettingService],
  exports: [SysDeviceService],
})
export class SysDeviceModule {}
