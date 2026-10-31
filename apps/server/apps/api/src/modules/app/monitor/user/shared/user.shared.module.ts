import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_AUTH_MONITOR_SERVICE } from '@walnut-server/auth'
import { WALNUT_ADMIN_IDENTITY_USER_NOTIFIER } from '@walnut-server/identity'
import { AppMonitorUserSharedService } from './user.shared.service'

/**
 * 批 6：WALNUT_ADMIN_IDENTITY_USER_NOTIFIER 绑定到本服务（user_lock 的 lock/unlock
 * socket 通知只认端口）；@Global 让 libs/identity 的模块无需 import 本模块。
 *
 * 批 8：WALNUT_ADMIN_AUTH_MONITOR_SERVICE 同款绑定（auth 登出链踢人只认端口）——
 * libs/auth 的 signout 服务不再 import 本模块。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    AppMonitorUserSharedService,
    {
      provide: WALNUT_ADMIN_IDENTITY_USER_NOTIFIER,
      useExisting: AppMonitorUserSharedService,
    },
    {
      provide: WALNUT_ADMIN_AUTH_MONITOR_SERVICE,
      useExisting: AppMonitorUserSharedService,
    },
  ],
  exports: [AppMonitorUserSharedService, WALNUT_ADMIN_IDENTITY_USER_NOTIFIER, WALNUT_ADMIN_AUTH_MONITOR_SERVICE],
})
export class AppMonitorUserSharedModule { }
