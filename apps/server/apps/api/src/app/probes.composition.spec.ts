import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AppTechRedisService } from '@walnut-server/cache'
import type { Response } from 'express'
import type { DataSource } from 'typeorm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mountProbeRoutes,
  PROBE_LIVE_PATH,
  PROBE_READY_PATH,
  PROBE_TIMEOUT_MS,
  setDraining,
} from './probes.composition'

/**
 * W2-B 探针复合单测（不启 Nest）：用 fake Express instance 捕获 raw route handler，
 * fake res 记录 status / header / body。钉住：
 * 1. live 同步 200；
 * 2. ready 全 up 200 + checks 形状 + no-store；
 * 3. pg 挂 → 503 且 checks 形状正确；
 * 4. redis 挂 → 503；
 * 5. 探测超时按 down 计（fake timers 推进 1.5s）；
 * 6. draining → ready 直接 503，不触达依赖；**live 仍 200**（liveness 不随 readiness 置位）；
 * 7. 挂载时不解析依赖（惰性 getter）；
 * 8. 响应体只有 status / checks 二值，不含敏感字段。
 */

interface ResState {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

type RawHandler = (req: unknown, res: Response) => void

function createHarness(deps: Parameters<typeof mountProbeRoutes>[1]) {
  const routes = new Map<string, RawHandler>()

  const app = {
    getHttpAdapter: () => ({
      getInstance: () => ({
        get: (path: string, handler: RawHandler) => {
          routes.set(path, handler)
        },
      }),
    }),
  } as unknown as NestExpressApplication

  mountProbeRoutes(app, deps)

  const invoke = async (path: string): Promise<ResState> => {
    const handler = routes.get(path)
    if (!handler) {
      throw new Error(`route not mounted: ${path}`)
    }

    return new Promise<ResState>((resolve) => {
      const state: ResState = { statusCode: 200, headers: {}, body: undefined }
      const res = {
        status(code: number) {
          state.statusCode = code
          return res
        },
        set(name: string, value: string) {
          state.headers[name.toLowerCase()] = value
          return res
        },
        json(body: unknown) {
          state.body = body
          resolve(state)
          return res
        },
      } as unknown as Response

      handler({}, res)
    })
  }

  return { invoke, routes }
}

function upPg(): DataSource {
  return { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) } as unknown as DataSource
}

function upRedis(): AppTechRedisService {
  return {
    getClient: () => ({ ping: vi.fn(async () => 'PONG') }),
  } as unknown as AppTechRedisService
}

function deps(overrides: Partial<Parameters<typeof mountProbeRoutes>[1]> = {}) {
  return {
    pg: () => upPg(),
    redis: () => upRedis(),
    ...overrides,
  }
}

afterEach(() => {
  setDraining(false)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('mountProbeRoutes', () => {
  it('live：同步 200 + { status: ok } + Cache-Control: no-store', async () => {
    const { invoke } = createHarness(deps())

    const res = await invoke(PROBE_LIVE_PATH)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('ready：PG 与 Redis 全 up → 200 + checks 两项 up + no-store', async () => {
    const { invoke } = createHarness(deps())

    const res = await invoke(PROBE_READY_PATH)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      status: 'ok',
      checks: { pg: 'up', redis: 'up' },
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('ready：PG 挂 → 503 + checks.pg=down / checks.redis=up（形状钉死）', async () => {
    const { invoke } = createHarness(deps({
      pg: () => ({ query: vi.fn(async () => { throw new Error('pg down') }) }) as unknown as DataSource,
    }))

    const res = await invoke(PROBE_READY_PATH)

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({
      status: 'error',
      checks: { pg: 'down', redis: 'up' },
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('ready：Redis 挂（PING 抛错）→ 503 + checks.redis=down', async () => {
    const { invoke } = createHarness(deps({
      redis: () => ({
        getClient: () => ({ ping: vi.fn(async () => { throw new Error('redis down') }) }),
      }) as unknown as AppTechRedisService,
    }))

    const res = await invoke(PROBE_READY_PATH)

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({
      status: 'error',
      checks: { pg: 'up', redis: 'down' },
    })
  })

  it('ready：PG 1.5s 内不返回 → 超时按 down 计（不无限挂住）', async () => {
    vi.useFakeTimers()
    const { invoke } = createHarness(deps({
      pg: () => ({ query: async () => new Promise(() => {}) }) as unknown as DataSource,
    }))

    const pending = invoke(PROBE_READY_PATH)
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
    const res = await pending

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({
      status: 'error',
      checks: { pg: 'down', redis: 'up' },
    })
  })

  it('draining：SIGTERM 置位后 ready 直接 503 { status: draining }，不触碰依赖', async () => {
    const pg = vi.fn(() => upPg())
    const redis = vi.fn(() => upRedis())
    const { invoke } = createHarness({ pg, redis })

    setDraining(true)
    const res = await invoke(PROBE_READY_PATH)

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ status: 'draining' })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(pg).not.toHaveBeenCalled()
    expect(redis).not.toHaveBeenCalled()
  })

  it('draining：/health/live 仍 200（liveness 只看进程存活，不随 readiness 置位）', async () => {
    const pg = vi.fn(() => upPg())
    const redis = vi.fn(() => upRedis())
    const { invoke } = createHarness({ pg, redis })

    setDraining(true)
    const res = await invoke(PROBE_LIVE_PATH)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers['cache-control']).toBe('no-store')
    // live 不探依赖：draining 也不该改变这一点
    expect(pg).not.toHaveBeenCalled()
    expect(redis).not.toHaveBeenCalled()
  })

  it('惰性依赖：挂载时不 app.get，请求到达时才解析', async () => {
    const pg = vi.fn(() => upPg())
    const redis = vi.fn(() => upRedis())

    const { invoke } = createHarness({ pg, redis })

    expect(pg).not.toHaveBeenCalled()
    expect(redis).not.toHaveBeenCalled()

    await invoke(PROBE_READY_PATH)

    expect(pg).toHaveBeenCalledTimes(1)
    expect(redis).toHaveBeenCalledTimes(1)
  })

  it('安全边界：响应体只有 status / checks，不含版本号 / 主机名 / 连接串 / 耗时', async () => {
    const { invoke } = createHarness(deps())

    const res = await invoke(PROBE_READY_PATH)
    const body = res.body as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(['checks', 'status'])
    expect(Object.keys(body.checks as Record<string, unknown>).sort()).toEqual(['pg', 'redis'])
    expect(JSON.stringify(body)).not.toMatch(/version|host|port|password|dsn|latency|duration|ms/i)
  })
})
