import type { HealthCheckAttempt } from '@nestjs/terminus'
import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { HealthIndicatorService } from '@nestjs/terminus'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

/**
 * PG 连通性探针（F-36 重构 / 裁决 Q6=b）。
 *
 * 背景：`health.controller` 原先直接注入 `@InjectDataSource(WalnutPGConnectionName)` 的
 * DataSource 交给 terminus 的 `TypeOrmHealthIndicator.pingCheck`，撞「controller 只装配、
 * 不触达数据层」的字面规矩。现在 DataSource 只在这个极小的 probe service 手里，controller
 * 只把它接到端点上。
 *
 * 为什么留在 app 侧（不进 libs）：health 是 **app 侧可观测面** —— 端点、swagger 壳、全局
 * 响应壳都在组合根，ADR 0022 的分层不为它开一个 lib 出口。
 *
 * 行为与迁移前**逐字等价**：`pingCheck('postgres', { connection })` 对 postgres 驱动执行的
 * 就是 `connection.query('SELECT 1')`，默认超时 1000ms，结果壳由 terminus 的
 * `HealthIndicatorService` 产出（`{ postgres: { status, responseTime, ... } }`，失败时
 * status 'down' + message，**不向调用方抛出**）。这里保留同一个 `HealthIndicatorService`
 * 与同一个 1000ms —— 只把「谁持有 DataSource」换成了本 service。
 */
@Injectable()
export class AppTechHealthProbeService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly pgDataSource: DataSource,

    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * @description PostgreSQL 连通性探针：对命名连接执行一条 `SELECT 1`
   *
   * 返回 terminus 的 attempt 构建器（thenable）—— controller 原样返回，与迁移前
   * `typeorm.pingCheck(...)` 的返回类型一致（`@HealthCheck()` 装饰器照旧只负责
   * Cache-Control 头）。
   */
  checkPostgres(): HealthCheckAttempt<'postgres'> {
    return this.healthIndicatorService
      .check('postgres')
      .attempt(async () => {
        await this.pgDataSource.query('SELECT 1')
      })
      .withTimeout(1000)
  }
}
