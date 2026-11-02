import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { AppTechHealthController } from './health.controller'
import { AppTechHealthProbeService } from './health.probe.service'

/**
 * health 端点组合（app 侧可观测面）。
 *
 * F-36 重构（裁决 Q6=b）：PG 探活下沉 `AppTechHealthProbeService`（注入命名连接的
 * DataSource 打 `SELECT 1`），controller 只装配。`HealthIndicatorService` 由
 * TerminusModule 提供（结果壳与超时语义照旧走 terminus）—— 所以不在这里注册 indicator。
 */
@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [AppTechHealthController],
  providers: [AppTechHealthProbeService],
})
export class AppTechHealthModule {}
