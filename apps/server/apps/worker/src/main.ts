import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { SchedulerRegistry } from '@nestjs/schedule'

import { WalnutAdminLogger } from '../../api/src/modules/techniques/logger'
import { WorkerModule } from './worker.module'

/**
 * worker 进程入口：同一镜像里**可选**的第二进程（libs 解耦批 10 收官）。
 *
 * - 只有应用上下文，没有 HTTP 监听（不占端口、不接流量）；
 * - cron 与 Bull 消费在这里跑；默认部署仍只有 api 单进程（不启动本入口），
 *   api 行为在未设 `WORKER_STANDALONE` 时与之前逐字节等价；
 * - `enableShutdownHooks`：收到 SIGTERM / SIGINT 时按 Nest 生命周期关闭 PG / Redis /
 *   Bull 连接，容器滚动更新不会留下半关闭的连接。
 *
 * 运行前提与 api 相同：**从 apps/server/ 目录启动**（ConfigModule 用 `process.cwd()`
 * 定位 env-local），PG / Redis 在线。启动方式见 package.json 的 `start:worker`。
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: WalnutAdminLogger,
  })

  // 容器/Docker stop 发 SIGTERM 时优雅关闭（createApplicationContext 已 init）
  app.enableShutdownHooks()

  const logger = new Logger('WorkerBootstrap')

  // cron 是否真的挂上了：WorkerModule 保证本进程一定注册过 ScheduleModule
  const registry = app.get(SchedulerRegistry)
  const cronJobs = [...registry.getCronJobs().keys()]

  logger.log(`worker process started (no HTTP listener); cron jobs: ${cronJobs.length}${cronJobs.length > 0 ? ` [${cronJobs.join(', ')}]` : ''}`)
  logger.log('worker consumes Bull queues and runs cron while the api process serves HTTP')
}

void bootstrap()
