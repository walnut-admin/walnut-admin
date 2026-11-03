import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AppCoreModule } from '../../api/src/app/core.module'
import { isWorkerStandalone } from '../../api/src/app/schedule.composition'
import { AppBootstrapTaskModule } from '../../api/src/modules/techniques/task/bootstrap-task.module'

/**
 * worker 的组合根（libs 解耦批 10 收官；W2-A 补 bootstrap 归属；批次 6 换 core 入口）。
 *
 * 入口从 AppModule 换成 **AppCoreModule**（apps/api/src/app/core.module.ts）：
 * AppModule 是 api + cli 的**全量图**（含 Express 中间件、12 条 APP_GUARD、
 * 5 个 HTTP 包装模块、DiscoveryModule），worker 只需要其中「没有请求也要跑」的那半。
 *
 * 这一步换来的不是「省点内存」，而是把三样带副作用的东西挡在**模块求值期**之外：
 * - Throttler 的 ThrottlerModule.forRootAsync（进程内计数器 + 启动日志）；
 * - SocketGateway（createApplicationContext 下永不被初始化，但会被实例化）；
 * - AppMiddlewareModule（Express 中间件只在 NestApplication.init() 里生效）。
 *
 * CAP 的隔离**不在本文件里完成** —— 它的入口是 libs/guards 的 barrel，只要还有 controller
 * 从 barrel 取装饰器，cap.service.ts 的 new Cap() 就仍会被求值。切断那条边的是
 * cap.guard.ts 的拆分（barrel 只导出 cap.decorator），证据在
 * apps/api/src/common/monorepo/worker-import-closure.drift.spec.ts。
 *
 * worker 唯一的额外职责是**承接调度**：WORKER_STANDALONE=true 时 api 组合根不注册
 * ScheduleModule（见 schedule.composition.ts），这里补上；未设时 AppCoreModule 里的
 * AppScheduleModule 自己已经注册过，这里不重复注册（避免同名 @Cron 重复挂载）。
 *
 * bootstrap 任务（AppBootstrapTaskModule）恒加载：WORKER_STANDALONE=true 时 api 的 AppModule
 * 已按同一判据让出，worker 是唯一的执行方；未设时 api 自己加载过（Nest 按模块类去重，
 * 不会重复 init）。注意「WORKER_STANDALONE=true 但只起 api 不起 worker」= bootstrap 不跑，
 * 属部署契约（见 bootstrap-task.module.ts 头注释）。
 *
 * Bull 队列的消费不需要在这里额外装配：AppTechCoreModule -> AppTechTaskModule 带起队列模块，
 * 多进程竞争消费由 Bull 自身保证（一个 job 只会被一个 consumer 取走）。
 */
@Module({
  imports: [
    AppCoreModule,
    AppBootstrapTaskModule,
    ...(isWorkerStandalone() ? [ScheduleModule.forRoot()] : []),
  ],
})
export class WorkerModule {}
