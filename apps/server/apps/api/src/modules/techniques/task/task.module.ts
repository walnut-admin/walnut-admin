import { Module } from '@nestjs/common'
import { AppKeyModule } from '@walnut-server/app-domain'

import { AuthRefreshSharedModule } from '@walnut-server/auth'
import { SysUserDeviceSharedModule, SysUserMfaSharedModule } from '@walnut-server/identity'
import { SysLocaleSharedModule } from '@walnut-server/system'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { AppTechTasksService } from './task.service'

/**
 * cron 任务的宿主模块（W2-A：纯 cron 注册，**不再**在 `onModuleInit` 里同步跑 bootstrap）。
 *
 * ScheduleModule 不在本模块注册：cron 的归属由 app 组合根的条件模块
 * （apps/api/src/app/schedule.composition.ts）决定 —— worker 独立部署时
 * api 让位，worker 自己的组合根注册。见 ADR 0022。
 *
 * 为什么 service provider 留在这里而不是 `AppBootstrapTaskModule`：
 * 两个模块在 api / worker 两种组合下都会同时可见（默认 api、独立 worker 各一份装配），
 * 若两处各 provide 一次 `AppTechTasksService`，@Cron 会被扫描到**两个实例**并因重名
 * 在 SchedulerOrchestrator 抛出 DUPLICATE_SCHEDULER —— 只能有一个 provider 实例。
 * bootstrap 模块因此 import 本模块复用同一实例，它只负责挂在哪个组合根。
 */
@Module({
  imports: [
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
export class AppTechTaskModule {}
