import type { DataSource } from 'typeorm'
import { HealthIndicatorService } from '@nestjs/terminus'
import { describe, expect, it, vi } from 'vitest'
import { AppTechHealthProbeService } from './health.probe.service'

/**
 * F-36（裁决 Q6=b）下沉后的 PG 探针单测：钉住「探针真的打一条 `SELECT 1`」与
 * 「结果壳仍是 terminus 的 `{ postgres: { status, ... } }`」。
 *
 * mock 的是 DataSource（只用到 `query`）—— 不连库；`HealthIndicatorService` 用 terminus
 * 真实现，这样 status / responseTime / 失败 message 的收口都由被测代码走真实路径。
 */
function makeProbe(queryImpl: (sql: string) => Promise<unknown>) {
  const query = vi.fn(queryImpl)
  const dataSource = { query } as unknown as DataSource
  const probe = new AppTechHealthProbeService(dataSource, new HealthIndicatorService())

  return { probe, query }
}

describe('app/health PG 探针（F-36：DataSource 归 probe service）', () => {
  it('成功路径：恰好一条 SELECT 1，结果壳是 { postgres: { status: up, responseTime } }', async () => {
    const { probe, query } = makeProbe(async () => [{ '?column?': 1 }])

    const result = await probe.checkPostgres()

    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('SELECT 1')
    expect(Object.keys(result)).toEqual(['postgres'])
    expect(result.postgres.status).toBe('up')
    expect(typeof result.postgres.responseTime).toBe('number')
  })

  it('失败路径：查询抛错 → status down + message，不向调用方抛出（与迁移前 pingCheck 一致）', async () => {
    const { probe } = makeProbe(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
    })

    const result = await probe.checkPostgres()

    expect(result.postgres.status).toBe('down')
    expect(result.postgres.message).toBe('connect ECONNREFUSED 127.0.0.1:5432')
  })
})
