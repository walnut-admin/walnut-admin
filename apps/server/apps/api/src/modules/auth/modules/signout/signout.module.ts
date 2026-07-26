import { Module } from '@nestjs/common'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { SysMenuSharedModule } from '@/modules/system/menu/shared/menu.shared.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSignoutService } from './signout.service'

@Module({
  imports: [AuthRefreshSharedModule, AppMonitorUserSharedModule, SysMenuSharedModule],
  providers: [AuthSignoutService],
  exports: [AuthSignoutService],
})
export class AuthSignoutModule {}
