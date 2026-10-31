import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AppModule } from '../../api/src/app/app.module'
import { isWorkerStandalone } from '../../api/src/app/schedule.composition'

/**
 * worker 的组合根（libs 解耦批 10 收官）。
 *
 * `AppModule` 是 api / worker 共用的同一份装配（同一镜像、同一份业务模块），
 * worker 唯一的额外职责是**承接 cron**：`WORKER_STANDALONE=true` 时 api 组合根
 * 不注册 `ScheduleModule`（见 `schedule.composition.ts`），这里补上；未设时
 * AppModule 自己已经注册过，这里不重复注册（避免同名 @Cron 重复挂载）。
 *
 * Bull 队列的消费不需要在这里额外装配：`AppTechQueueModule` 随 AppModule 装载，
 * 多进程竞争消费由 Bull 自身保证（一个 job 只会被一个 consumer 取走）。
 */
@Module({
  imports: [
    AppModule,
    ...(isWorkerStandalone() ? [ScheduleModule.forRoot()] : []),
  ],
})
export class WorkerModule {}
