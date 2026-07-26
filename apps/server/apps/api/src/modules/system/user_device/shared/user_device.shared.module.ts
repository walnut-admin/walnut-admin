import { Module } from '@nestjs/common'
import { SysDeviceSharedModule } from '../../device/shared/device.shared.module'
import { SysUserDeviceSharedService } from './user_device.shared.service'

@Module({
  imports: [
    SysDeviceSharedModule,
  ],
  controllers: [],
  providers: [SysUserDeviceSharedService],
  exports: [SysUserDeviceSharedService],
})
export class SysUserDeviceSharedModule { }
