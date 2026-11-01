import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AppModule } from '../../api/src/app/app.module'
import { isWorkerStandalone } from '../../api/src/app/schedule.composition'
import { AppBootstrapTaskModule } from '../../api/src/modules/techniques/task/bootstrap-task.module'

/**
 * worker 的组合根（libs 解耦批 10 收官；W2-A 补 bootstrap 归属）。
 *
 * `AppModule` 是 api / worker 共用的同一份装配（同一镜像、同一份业务模块），
 * worker 唯一的额外职责是**承接调度**：`WORKER_STANDALONE=true` 时 api 组合根
 * 不注册 `ScheduleModule`（见 `schedule.composition.ts`），这里补上；未设时
 * AppModule 自己已经注册过，这里不重复注册（避免同名 @Cron 重复挂载）。
 *
 * bootstrap 任务（`AppBootstrapTaskModule`）恒加载：`WORKER_STANDALONE=true` 时
 * api 的 AppModule 已按同一判据让出，worker 是唯一的执行方；未设时 AppModule 自己
 * 加载过（Nest 按模块类去重，不会重复 init）。注意「WORKER_STANDALONE=true 但只起
 * api 不起 worker」= bootstrap 不跑，属部署契约（见 bootstrap-task.module.ts 头注释）。
 *
 * Bull 队列的消费不需要在这里额外装配：`AppTechQueueModule` 随 AppModule 装载，
 * 多进程竞争消费由 Bull 自身保证（一个 job 只会被一个 consumer 取走）。
 */
@Module({
  imports: [
    AppModule,
    AppBootstrapTaskModule,
    ...(isWorkerStandalone() ? [ScheduleModule.forRoot()] : []),
  ],
})
export class WorkerModule {}
