import { Module, OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { SysUserDeviceSharedModule, SysUserMfaSharedModule } from '@walnut-server/identity'

import { SysLocaleSharedModule } from '@walnut-server/system'
import { AppKeyModule } from '@/modules/app/key/key.module'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { AuthRefreshSharedModule } from '@/modules/auth/modules/refresh/shared/refresh.shared.module'
import { AppTechTasksService } from './task.service'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SysLocaleSharedModule,
    AuthRefreshSharedModule,
    // PG 版过期 refresh token purge job（@Cron）随 AuthRefreshModule 注册（B7b 归一，
    // 原过渡文件 refresh.pg.module 已并入该模块）
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
