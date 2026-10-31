import process from 'node:process'
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

/**
 * cron 归属的条件组合（libs 解耦批 10 收官：worker 组合入口）。
 *
 * 语义：`WORKER_STANDALONE === 'true'` 表示**同一镜像里另有独立 worker 进程**在跑 ——
 * 此时 HTTP api 进程让出 cron（不注册 `ScheduleModule.forRoot()`），避免同一批
 * `@Cron` 在两个进程里各跑一遍；worker 自己的组合根（`apps/worker`）同样按该 env 条件注册
 *（脚本注入 `WORKER_STANDALONE=true`）——cron 因此只有一处归属；**api 侧的 env 要靠
 * 部署环境显式给**（容器 env），没有脚本代注入。
 *
 * 默认（未设该 env）= 现状：api 单进程全功能，cron 照旧在 api 里跑。
 *
 * 为什么只让位 cron：Bull 的多进程是**竞争消费**（同一队列多个 consumer 安全，
 * 每个 job 只会被一个消费者取走），不需要开关；@Cron 则是每个进程各起一份定时器，
 * 必须显式让位。
 *
 * 判定读 `process.env` 而不是 ConfigService：`@Module()` 的 imports 在模块定义期求值，
 * 早于 Nest DI 容器建立（ConfigModule 尚未加载）；而 `WORKER_STANDALONE` 是进程级
 * 启动开关（由 `start:worker` 的 cross-env 注入），本来就不在 env 文件里。
 */
export function isWorkerStandalone(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKER_STANDALONE === 'true'
}

@Module({
  imports: isWorkerStandalone() ? [] : [ScheduleModule.forRoot()],
})
export class AppScheduleModule {}
