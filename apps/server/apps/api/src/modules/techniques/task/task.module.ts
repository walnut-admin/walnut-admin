import process from 'node:process'
import { Module, OnModuleInit } from '@nestjs/common'
import { AppKeyModule } from '@walnut-server/app-domain'

import { AuthRefreshSharedModule } from '@walnut-server/auth'
import { SysUserDeviceSharedModule, SysUserMfaSharedModule } from '@walnut-server/identity'
import { SysLocaleSharedModule } from '@walnut-server/system'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { AppTechTasksService } from './task.service'

/**
 * bootstrap 任务开关：`WALNUT_ADMIN_BOOTSTRAP_TASKS === 'off'` 时跳过 `onModuleInit`
 * 里的 6 个预热/清理任务。
 *
 * 动机：cli 上下文（`openapi:export` 只为反射 schema）与未来无任务角色不应产生业务
 * 副作用 —— `rotateAppKey` 非幂等（键已过期时导出会触发轮换）是不可接受的；settings /
 * locale 预热、RT 清理、device/MFA 统计同样没有意义。cron 注册由 AppScheduleModule
 * 负责，**不受本开关影响**。
 *
 * 判定读 `process.env` 而不是 ConfigService：这是进程级启动开关（由 package.json 的
 * `openapi:export` 经 cross-env 注入），与 `schedule.composition.ts` 的
 * `WORKER_STANDALONE` 同口径；默认（未设该 env）= 现状，api 启动照旧跑满 6 个任务。
 */
export function isBootstrapTasksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WALNUT_ADMIN_BOOTSTRAP_TASKS === 'off'
}

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
    // cli / 无任务角色跳过 bootstrap 段（见 isBootstrapTasksDisabled 注释）；cron 注册不受影响
    if (isBootstrapTasksDisabled()) {
      return
    }
    // execute on module init
    await this.taskService.extractAppSetting()
    await this.taskService.extractSysLocaleMessages()
    await this.taskService.deleteExpiredRefreshToken()
    await this.taskService.rotateAppKey()
    await this.taskService.updateDeviceActiveStatus()
    await this.taskService.updateMfaSetupStatus()
  }
}
