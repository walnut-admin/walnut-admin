import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE } from '@walnut-server/identity'
import { SysMenuSharedModule } from '@walnut-server/system'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSignoutService } from './signout.service'

/**
 * @Global：批 6 起 libs/identity 的 user_device.forceQuit 只认
 * WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE 端口；本模块在 app 组合根绑定实现。
 *
 * 批 8：在线监控踢人（WALNUT_ADMIN_AUTH_MONITOR_SERVICE）与事后风险清理
 * （WALNUT_ADMIN_AUTH_RISK_SERVICE）两个端口由 app 组合根全局绑定，
 * 本模块不再 import app monitor / security 模块。
 */
@Global()
@Module({
  imports: [AuthRefreshSharedModule, SysMenuSharedModule],
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
