import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE } from '@walnut-server/identity'
import { IdentityDeviceBridge } from '../identity-device.bridge'
import { SysDeviceRepositoryModule } from '../repo/device.repo.module'
import { SysDeviceSharedService } from './device.shared.service'

/**
 * 批 6：WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE 由 IdentityDeviceBridge 实现并绑定
 * （user_device 的 device 读腿只认端口）；@Global 让 libs/identity 免 import app。
 */
@Global()
@Module({
  imports: [
    SysDeviceRepositoryModule,
  ],
  controllers: [],
  providers: [
    SysDeviceSharedService,
    IdentityDeviceBridge,
    {
      provide: WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE,
      useExisting: IdentityDeviceBridge,
    },
  ],
  exports: [SysDeviceSharedService, WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE],
})
export class SysDeviceSharedModule { }
