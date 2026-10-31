import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE } from '@walnut-server/identity'
import { SysMenuSharedModule } from '@walnut-server/system'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSignoutService } from './signout.service'

/**
 * @Global：批 6 起 libs/identity 的 user_device.forceQuit 只认
 * WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE 端口；本模块在 app 组合根绑定实现。
 */
@Global()
@Module({
  imports: [AuthRefreshSharedModule, AppMonitorUserSharedModule, SysMenuSharedModule],
  providers: [
    AuthSignoutService,
    {
      provide: WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE,
      useExisting: AuthSignoutService,
    },
  ],
  exports: [AuthSignoutService, WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE],
})
export class AuthSignoutModule {}
