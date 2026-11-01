import process from 'node:process'
import { Module, OnModuleInit } from '@nestjs/common'
import { AppTechTaskModule } from './task.module'
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

/**
 * 启动期 bootstrap 任务（W2-A 从 `AppTechTaskModule` 拆出）。
 *
 * 归属语义（与 cron 的条件注册同一套组合根口径，见 `schedule.composition.ts`）：
 * - 默认（未设 `WORKER_STANDALONE`）：归 api —— `AppModule` 直接 import 本模块；
 * - `WORKER_STANDALONE=true`：归 worker —— api 的 `AppModule` 不加载本模块，
 *   `WorkerModule` 恒加载。
 *
 * **部署契约（`WORKER_STANDALONE=true` 时 worker 必须运行）**：让位同时带来两个退化面，
 * 且都以「worker 在跑」为前提 ——
 * 1. **cron 让位**：api 不注册 `ScheduleModule`；worker 不起则**没有任何 `@Cron` tick**
 *    （不是延后，是彻底不跑）；
 * 2. **预热迁移**：settings / locale 缓存改由 worker 的 bootstrap 写入共享 Redis，api
 *    读同一份。worker 不起时 api 的 `getSetting` 退化为默认值并逐次打 error 日志，
 *    langId 校验也会放行，直到 worker 首跑（或 02:00 的 cron —— 同样需要 worker）。
 *
 * 这不是故障，是组合根让位的语义；api 启动时有一条让位 warn（`main.ts` 调
 * `warnIfWorkerStandalone`）。只想起 api 时不要设 `WORKER_STANDALONE=true`。
 *
 * bootstrap 调用服务上的 `runBootstrapXxx()` 无锁入口：不占 Redis cron 锁，归属已由
 * 组合根保证单份（见任务方法注释；无锁入口是独立方法而非布尔参数，避免误用面）。
 */
@Module({
  // 复用 AppTechTaskModule 的同一份 AppTechTasksService 实例（provider 只能有一处，
  // 否则 @Cron 重名注册会抛 DUPLICATE_SCHEDULER，见 task.module.ts 头注释）。
  imports: [AppTechTaskModule],
})
export class AppBootstrapTaskModule implements OnModuleInit {
  constructor(private readonly taskService: AppTechTasksService) {}

  async onModuleInit() {
    // cli / 无任务角色跳过 bootstrap 段（见 isBootstrapTasksDisabled 注释）；cron 注册不受影响
    if (isBootstrapTasksDisabled()) {
      return
    }
    // execute on module init
    await this.taskService.runBootstrapExtractAppSetting()
    await this.taskService.runBootstrapExtractSysLocaleMessages()
    await this.taskService.runBootstrapDeleteExpiredRefreshToken()
    await this.taskService.runBootstrapRotateAppKey()
    await this.taskService.runBootstrapUpdateDeviceActiveStatus()
    await this.taskService.runBootstrapUpdateMfaSetupStatus()
  }
}
