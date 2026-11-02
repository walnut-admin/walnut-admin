import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_SYSTEM_DEVICE_KICKER } from '@walnut-server/system'
import { SysDeviceKickService } from './device.kick.service'

/**
 * 设备封禁踢下线端口的绑定（review 拍板-4）。
 *
 * @Global：消费方是 `libs/system` 的 `SysDeviceService`（@Inject(WALNUT_ADMIN_SYSTEM_DEVICE_KICKER)），
 * 而实现在 app（依赖 SocketService）—— 与 `AppMonitorUserSharedModule` 绑定
 * `WALNUT_ADMIN_AUTH_MONITOR_SERVICE` 同款口径：端口实现与绑定留在组合根，lib 侧只认 token。
 * 缺绑定 = 启动期 DI 报错，不会静默跳过。
 */
@Global()
@Module({
  imports: [],
  providers: [
    SysDeviceKickService,
    {
      provide: WALNUT_ADMIN_SYSTEM_DEVICE_KICKER,
      useExisting: SysDeviceKickService,
    },
  ],
  exports: [SysDeviceKickService, WALNUT_ADMIN_SYSTEM_DEVICE_KICKER],
})
export class SysDeviceKickModule {}
