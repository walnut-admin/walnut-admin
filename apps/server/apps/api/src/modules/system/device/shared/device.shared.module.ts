import { Module } from '@nestjs/common'
import { SysDeviceRepositoryModule } from '../repo/device.repo.module'
import { SysDeviceSharedService } from './device.shared.service'

@Module({
  imports: [
    SysDeviceRepositoryModule,
  ],
  controllers: [],
  providers: [SysDeviceSharedService],
  exports: [SysDeviceSharedService],
})
export class SysDeviceSharedModule { }
