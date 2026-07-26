import { Module, OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppKeyModule } from '@/modules/app/key/key.module'

import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'

import { AuthRefreshSharedModule } from '@/modules/auth/modules/refresh/shared/refresh.shared.module'
import { SysLocaleSharedModule } from '@/modules/system/locale/shared/locale.shared.module'
import { SysUserDeviceSharedModule } from '@/modules/system/user_device/shared/user_device.shared.module'
import { SysUserMfaSharedModule } from '@/modules/system/user_mfa/shared/user_mfa.shared.module'
import { AppTechTasksService } from './task.service'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SysLocaleSharedModule,
    AuthRefreshSharedModule,
    AppKeyModule,
    SysUserDeviceSharedModule,
    AppMonitorUserSharedModule,
    SysUserMfaSharedModule,
  ],
  providers: [AppTechTasksService],
  exports: [AppTechTasksService],
})
export class AppTechTaskModule implements OnModuleInit {
  constructor(private readonly taskService: AppTechTasksService) {}

  async onModuleInit() {
    // execute on module init
    await this.taskService.extractAppSetting()
    await this.taskService.extractSysLocaleMessages()
    await this.taskService.deleteExpiredRefreshToken()
    await this.taskService.rotateAppKey()
    await this.taskService.updateDeviceActiveStatus()
    await this.taskService.updateMfaSetupStatus()
  }
}
