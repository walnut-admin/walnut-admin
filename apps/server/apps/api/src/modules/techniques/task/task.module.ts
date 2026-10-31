import { Module, OnModuleInit } from '@nestjs/common'
import { AppKeyModule } from '@walnut-server/app-domain'

import { AuthRefreshSharedModule } from '@walnut-server/auth'
import { SysUserDeviceSharedModule, SysUserMfaSharedModule } from '@walnut-server/identity'
import { SysLocaleSharedModule } from '@walnut-server/system'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { AppTechTasksService } from './task.service'

@Module({
  imports: [
    // ScheduleModule 不在本模块注册：cron 的归属由 app 组合根的条件模块
    // （apps/api/src/app/schedule.composition.ts）决定 —— worker 独立部署时
    // api 让位，worker 自己的组合根注册。见 ADR 0022。
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
