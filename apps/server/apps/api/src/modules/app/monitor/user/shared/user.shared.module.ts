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
 *
 * 批 9：监控用户的数据面（repo / service / entity）已下沉 `@walnut-server/app-domain`，
 * 但本实现与绑定留 app —— `AppMonitorUserSharedService` 依赖 app 的 `SocketService`
 * （socket 命名空间在 app），下沉需要再加一个 socket 端口；按批 6/8 的既定口径，
 * 端口实现与绑定留在组合根（同 auth.ports.ts 顶注），lib 侧只认端口 token。
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
