import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AppTechRedisService } from '@walnut-server/cache'
import type { Request, Response } from 'express'
import type { DataSource } from 'typeorm'

/**
 * 探针组合（W2-B）：`/health/live` 与 `/health/ready` 的**挂载时机契约**。
 *
 * ## 必须在 `NestFactory.create()` 之后、`app.listen()` 之前挂载
 *
 * 这里注册的是**裸 Express 路由**（`app.getHttpAdapter().getInstance().get(...)`），
 * 它只进 Express 自己的路由表。Nest 的 router（controllers）、全局中间件、整条
 * `APP_GUARD` 链、全局响应包装拦截器、全局异常过滤器与兜底 404 handler 全部在
 * `listen()` 触发的 `app.init()` 里才注册 —— 于是请求先被本文件的路由接住，
 * 探针因此逃逸整套 Nest 增强链。
 *
 * **为什么必须逃逸**：
 * - 全局异常过滤器把一切错误兜成 **HTTP 200**（`body.code = 50000`），readiness
 *   永远 200 就失去意义，编排层看不出依赖已挂；
 * - 11 个 `APP_GUARD` 要求设备指纹 / JWT / 签名等握手，容器 healthcheck 与部署自检
 *   不可能完成；
 * - 全局成功拦截器会把响应包成 `{ code, data, message }`，探针契约应保持最小 JSON。
 *
 * 同理，本文件的 raw 路由**不会进入 openapi.json**（没有 Nest 装饰器，RouterExplorer
 * 不扫描）—— `pnpm openapi:export` 应保持零 diff。
 *
 * ## 安全边界
 *
 * 响应体只有 `status` 与 `checks.{pg,redis}` 的二值，**不暴露**版本号、主机名、
 * IP / 连接串、耗时与错误栈；`Cache-Control: no-store` 防中间缓存。公网不可达：
 * `deploy/nginx/conf.d/api.conf` 对 `/health/` 直接 404，探针只挂在编排网络
 * （docker compose healthcheck / 部署自检）内部。
 *
 * ## liveness / readiness 语义
 *
 * - `/health/live`：进程存活即刻 200，**不探依赖** —— 依赖故障不该让编排层重启一个
 *   健康的进程。
 * - `/health/ready`：并发探 PG（`SELECT 1`）与 Redis（`PING`），各自 1.5s 超时；
 *   全过 200，任一失败/超时 503。收到 SIGTERM / SIGINT 后进入 draining，直接 503
 *   `{ status: 'draining' }`（main.ts 置位，与 `enableShutdownHooks` 的优雅关闭并行）。
 */

export const PROBE_LIVE_PATH = '/health/live'
export const PROBE_READY_PATH = '/health/ready'

/** 单项依赖的探测超时（并发执行，总等待不超过该值） */
export const PROBE_TIMEOUT_MS = 1500

export interface ProbeDeps {
  pg: () => DataSource
  redis: () => AppTechRedisService
}

/** SIGTERM / SIGINT 后置位：readiness 立即 503，编排层停止把新流量导进来 */
let draining = false

/** 导出给 main.ts 的信号监听（同步置位，与 `enableShutdownHooks` 互不干扰） */
export function setDraining(value: boolean): void {
  draining = value
}

interface RawExpressInstance {
  get: (path: string, handler: (req: Request, res: Response) => void) => unknown
}

/**
 * 挂载 `/health/live` 与 `/health/ready`。
 *
 * `deps` 用惰性 getter：挂载时**不解析** Nest 容器里的 PG / Redis 实例，只在请求到达时
 * 才 `app.get(...)`，避免 bootstrap 早于依赖就绪。
 */
export function mountProbeRoutes(app: NestExpressApplication, deps: ProbeDeps): void {
  const instance = app.getHttpAdapter().getInstance() as RawExpressInstance

  instance.get(PROBE_LIVE_PATH, (_req: Request, res: Response) => {
    res.status(200).set('Cache-Control', 'no-store').json({ status: 'ok' })
  })

  instance.get(PROBE_READY_PATH, (_req: Request, res: Response) => {
    // 实装是 Express 5.3：它会接住 async handler 的 rejection 并交给错误处理链。但探针
    // 挂在 Nest 全局异常过滤器之外，错误落到 Express 默认处理器会按 500 打栈/写日志；
    // 这里显式 catch 让「写响应失败」静默，写法不依赖框架对 async 的支持（仍保持安全）。
    void handleReady(res, deps).catch(() => {
      // 连接已断开等写响应失败：探针失败不应影响进程本身
    })
  })
}

async function handleReady(res: Response, deps: ProbeDeps): Promise<void> {
  if (draining) {
    res.status(503).set('Cache-Control', 'no-store').json({ status: 'draining' })
    return
  }

  // 并发探测：总耗时不叠加（任一超时按 down 计，仍等待另一项）
  const [pgUp, redisUp] = await Promise.all([
    probeWithinTimeout(async () => deps.pg().query('SELECT 1')),
    probeWithinTimeout(async () => deps.redis().getClient().ping()),
  ])

  const ok = pgUp && redisUp

  res
    .status(ok ? 200 : 503)
    .set('Cache-Control', 'no-store')
    .json({
      status: ok ? 'ok' : 'error',
      checks: { pg: pgUp ? 'up' : 'down', redis: redisUp ? 'up' : 'down' },
    })
}

/** 把一次探测归一成布尔：成功 true；抛错 / 超时 false（超时后原 promise 的后续结果被丢弃） */
async function probeWithinTimeout(
  check: () => Promise<unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`probe timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })

  try {
    await Promise.race([check(), timeout])
    return true
  }
  catch {
    return false
  }
  finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
