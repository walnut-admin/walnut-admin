import { Module } from '@nestjs/common'
import { SysUserDeviceSharedService } from './user_device.shared.service'

@Module({
  imports: [],
  controllers: [],
  providers: [SysUserDeviceSharedService],
  exports: [SysUserDeviceSharedService],
})
export class SysUserDeviceSharedModule { }
