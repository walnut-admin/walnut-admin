import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { DataSource } from 'typeorm'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import {
  buildSignRaw,
  computeSingleFactorSign,
  generateNonce,
  WALNUT_TEST_USER_AGENT,
} from './helpers/sign-handshake'

/**
 * L4：连接占用 spike 实测（docs/plans/data-scope-remediation-plan.md §4.1/§4.2 前置项）。
 *
 * 背景：三期 RLS 让「无 em 的注册实体 CRUD」各自开隐式事务（基类 `withScopedManager`：
 * 取连接 → `SET TRANSACTION READ ONLY` → `set_config` 写 RLS GUC → 查询 → 提交 → 释放）。
 * 计划自列的「连接占用实测」一直没做，本 spec 补测量、**不改变行为**：
 *
 * - 靶端点：`POST /app/demo/list`（app_demo 是注册表实体，row 级部门归属，root 走 ALL）；
 * - 先测串行基线（warmup + 逐请求），再预热连接池（把池扩到上限、结果丢弃），
 *   然后以 `2 × 池上限` 并发轰一波；
 * - 对照波：同并发度打 `GET /`（不触达 PG）—— 端到端 p95 里扣掉测试客户端与
 *   事件循环的固定开销，剩下的才归因到连接排队；
 * - 轰击期间 1ms 采样 pg Pool 的 `totalCount / idleCount / waitingCount`，并给
 *   `pool.connect` 包一层计取连接等待（本波生效、波后还原）；
 * - 记录 p95 延迟、基线延迟、waiting 峰值、疑似排队请求占比（延迟 > 2 × 基线中位数）。
 *
 * **判定口径**：主 `verdict` 只按「取连接等待」（acquire p95/max vs 50ms）—— e2e
 * 指标含测试客户端固定开销且 2× 池并发下排队占比结构性 ≥50%，只作 `verdictE2E`
 * 诊断字段，不参与阈值判定。**断言从宽**：只断全部请求最终 200 + 业务码 20000
 * （无 5xx）与 acquireCount 的宽上限；决策阈值只打印给人看，**不让测试因阈值红**
 * —— 本 spec 是测量，不是门禁。
 *
 * 池上限从运行期 pg Pool 的 `options.max` 读取（TypeORM 未显式配置 poolSize 时
 * pg 的缺省值生效），测试不硬编码池大小。
 */

interface IDemoRow {
  id: string
}

/**
 * 最小 structural 视图：pg.Pool 的公开计数属性（pg-pool 不带类型，@types/pg 只覆盖
 * Client/Query）。TypeORM 1.1.2 的 PostgresDriver 把池存在 `master`；该类**没有**
 * `pool` 字段 —— `driver.pool` 只是纯防御分支（兼容未来版本改名），找不到直接抛，
 * 测量口径不明时不能静默跑。
 */
interface IWalnutPgPoolProbe {
  totalCount: number
  idleCount: number
  waitingCount: number
  options?: { max?: number }
  /** pg-pool 的回调式取连接（TypeORM 的 QueryRunner.connect 走这里） */
  connect: (cb: (err: Error | undefined, client: unknown, release: (err?: Error) => void) => void) => void
}

interface IWalnutPgPoolSample {
  total: number
  idle: number
  /** 占用中的连接数（pg Pool 没有直接暴露，用 total - idle 计算） */
  inUse: number
  waiting: number
}

const BASELINE_WARMUP = 3
const BASELINE_SAMPLES = 12
const BURST_MULTIPLIER = 2
/** 决策阈值（计划 §4.2 写死，仅作判定话术，不做断言）—— 主判定读「取连接等待」p95/max */
const P95_THRESHOLD_MS = 50
/** E2E 诊断口径（排队占比）；2× 池并发下结构性 ≥50%，不用于主判定 */
const QUEUED_RATIO_THRESHOLD = 0.05

function resolvePgPool(dataSource: DataSource): IWalnutPgPoolProbe {
  const driver = dataSource.driver as unknown as {
    pool?: IWalnutPgPoolProbe
    master?: IWalnutPgPoolProbe
  }
  const pool = driver.pool ?? driver.master

  if (pool === undefined) {
    throw new Error('[pool-occupancy] 无法从 DataSource.driver 拿到 pg Pool（TypeORM 版本变更？）')
  }

  return pool
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return Number.NaN
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

describe('L4：连接占用 spike（注册实体 CRUD 的隐式事务 × 池排队实测）', () => {
  let app: NestExpressApplication | undefined
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  /** 本 spec 造的 demo 行（finally + afterAll 双清理，保证可重复跑） */
  const demoIds: string[] = []

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `pool-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 3 行真实数据：list 走一遍带行集的查询（查询本身不是测量重点，连接占用才是）
    for (const tag of ['S1', 'S2', 'S3']) {
      const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(tag))
      expectOk(res, `demo create ${tag}`)
      demoIds.push(bodyOf<IDemoRow>(res).data.id)
    }
  })

  afterAll(async () => {
    if (app === undefined) {
      return
    }

    if (api !== undefined && fixture !== null) {
      await deleteDemoRows()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await app.get(AppTechCacheDeviceService).delSysDeviceCache(api.deviceId)
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  function demoPayload(tag: string) {
    return {
      demoString: `POOL-${seed8.toUpperCase()}-${tag}`,
      demoPhoneNumber: `133${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      demoNumber: 1,
      demoBoolean: true,
      demoDate: '2026-01-01T00:00:00.000Z',
      demoEnum: 1,
      demoMongoId: randomUUID(),
      demoObject: { o1: 'OBJ', o2: 2, o3: false },
      demoStringArray: ['1', 'a'],
      demoNumberArray: [-1, 2],
      demoBooleanArray: [true],
      demoDateArray: ['2026-01-01T00:00:00.000Z'],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [randomUUID()],
    }
  }

  const listBody = {
    query: {},
    sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
    page: { page: 1, pageSize: 10 },
  }

  async function listOnce(): Promise<number> {
    const startedAt = performance.now()
    const res = await api.root('POST', api.apiPath('/app/demo/list'), listBody)
    const elapsed = performance.now() - startedAt

    expectOk(res, 'demo list')
    return elapsed
  }

  /**
   * 对照端点：`GET /`（AppController.getHello）—— 穿过同一套中间件栈（签名头 / cookie /
   * 全局异常壳 / 序列化），但**不触达 PG**。该端点 JwtFree，因此只能走匿名单因子签名
   * （api 客户端已 setAuth，root() 会按双因子签 → 40112）；认证后的 guard（MFA/lock）不参与，
   * 所以它给出的是测试客户端（supertest 每请求起一次临时 HTTP server）与单线程事件循环
   * 固定开销的**下界** —— 端到端 p95 里扣掉它，剩下的才更像连接排队的贡献。
   */
  async function helloOnce(): Promise<number> {
    const url = api.apiPath('/')
    const timestamp = Date.now()
    const nonce = generateNonce()
    const raw = buildSignRaw({
      method: 'GET',
      // 与 sign.guard buildSignRaw 同口径：去掉 `/{prefix}/v{version}` 前缀
      routePath: url.replace(/^\/[^/]+\/v\d+/, '') || '/',
      body: undefined,
      timestamp,
      nonce,
      ua: WALNUT_TEST_USER_AGENT,
    })

    const startedAt = performance.now()
    const res = await api.unsigned('GET', url, undefined, {
      'X-Sign': computeSingleFactorSign(raw, api.handshakeAesKey),
      'X-Timestamp': String(timestamp),
      'X-Nonce': nonce,
    })
    const elapsed = performance.now() - startedAt

    expectOk(res, 'root hello')
    return elapsed
  }

  async function deleteDemoRows(): Promise<void> {
    if (demoIds.length === 0) {
      return
    }
    await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [demoIds])
    demoIds.length = 0
  }

  it('spike：2 × 池上限并发下的 p95 / waiting 峰值 / 排队占比（只测不断言阈值）', async () => {
    const pool = resolvePgPool(api.appDataSource)
    const poolMax = pool.options?.max

    // 池上限必须能从运行期配置读到（读不到 = 测量口径不明，直接红，不猜缺省值）
    if (typeof poolMax !== 'number' || poolMax <= 0) {
      throw new Error(`[pool-occupancy] pg Pool 的 options.max 不可用（${String(poolMax)}），无法确定并发度`)
    }

    const concurrency = BURST_MULTIPLIER * poolMax

    try {
      // ---- 1. 串行基线（warmup 丢弃，避免首请求冷路径污染）----
      for (let i = 0; i < BASELINE_WARMUP; i++) {
        await listOnce()
      }

      const baselineLatencies: number[] = []
      for (let i = 0; i < BASELINE_SAMPLES; i++) {
        baselineLatencies.push(await listOnce())
      }

      const baselineMedianMs = round2(percentile(baselineLatencies, 50))
      const baselineP95Ms = round2(percentile(baselineLatencies, 95))

      // ---- 1.5 连接池预热（不采样）：把池扩到上限后留在 idle ----
      // 测的是「连接占用 / 排队」，不是「建连成本」：串行基线只用到 1 条连接，若不预热，
      // 第一波并发里大半延迟来自 pg 新建后端连接（冷启动 TCP + auth），会把排队占比
      // 放大成 100%，掩盖真正稳态的占用形态。预热波的结果丢弃（同时顺带验证并发下
      // 全部 20000，失败会在 listOnce 里直接抛）。
      await Promise.all(Array.from({ length: concurrency }, async () => listOnce()))
      const poolTotalAfterWarmup = pool.totalCount

      // ---- 1.6 对照波（不触达 PG）：同一并发度打 GET /，量化测试客户端与事件循环开销 ----
      const controlLatencies = await Promise.all(
        Array.from({ length: concurrency }, async () => helloOnce()),
      )
      const controlP95Ms = round2(percentile(controlLatencies, 95))

      // ---- 2. 并发轰击 + 池采样 ----
      // 采样 waitingCount 只能看「有没有人等」；再包一层 pool.connect 量出「等了多久」
      // 与「多少比例的取连接真的等待过」。前提：TypeORM 1.1.2 的 QueryRunner.connect 经
      // PostgresDriver.obtainMasterConnection 走 pg Pool 的**回调形态** `connect(cb)`
      // （无 Promise 重载）；若上游改形态，本补丁需同步改造。补丁只在本波生效。
      const originalConnect = pool.connect.bind(pool)
      const acquireWaits: number[] = []
      pool.connect = (cb) => {
        const startedAt = performance.now()
        originalConnect((err, client, release) => {
          acquireWaits.push(performance.now() - startedAt)
          cb(err, client, release)
        })
      }

      const samples: IWalnutPgPoolSample[] = []
      const sampler = setInterval(() => {
        const total = pool.totalCount
        const idle = pool.idleCount
        samples.push({
          total,
          idle,
          inUse: total - idle,
          waiting: pool.waitingCount,
        })
      }, 1)

      const burstLatencies: number[] = []
      let settled: PromiseSettledResult<SuperTestResponse>[]
      try {
        settled = await Promise.allSettled(
          Array.from({ length: concurrency }, async () => {
            const startedAt = performance.now()
            try {
              const res = await api.root('POST', api.apiPath('/app/demo/list'), listBody)
              burstLatencies.push(performance.now() - startedAt)
              return res
            }
            catch (e) {
              burstLatencies.push(performance.now() - startedAt)
              throw e
            }
          }),
        )
      }
      finally {
        pool.connect = originalConnect
        clearInterval(sampler)
      }

      const rejected = settled.filter(result => result.status === 'rejected')
      const responses = settled
        .filter((result): result is PromiseFulfilledResult<SuperTestResponse> => result.status === 'fulfilled')
        .map(result => result.value)

      const burstP95Ms = round2(percentile(burstLatencies, 95))
      const burstMedianMs = round2(percentile(burstLatencies, 50))
      const waitingPeak = samples.reduce((max, sample) => Math.max(max, sample.waiting), 0)
      const totalPeak = samples.reduce((max, sample) => Math.max(max, sample.total), 0)
      const inUsePeak = samples.reduce((max, sample) => Math.max(max, sample.inUse), 0)
      const idleMin = samples.length === 0
        ? Number.NaN
        : samples.reduce((min, sample) => Math.min(min, sample.idle), Number.POSITIVE_INFINITY)
      const waitingSampleRatio = samples.length === 0
        ? Number.NaN
        : samples.filter(sample => sample.waiting > 0).length / samples.length
      // diagnostic（不参与主判定）：2× 池并发下「延迟 > 2×基线」结构性 ≥50% ——
      // 10 条连接服务 20 个请求，后一半必然排到第一波结束；只作参考数字。
      const queued = burstLatencies.filter(ms => ms > baselineMedianMs * 2).length
      const queuedRatio = burstLatencies.length === 0 ? 0 : queued / burstLatencies.length

      // 取连接等待（直接形态）：>1ms 视为真的等过（池空闲时 checkout 在微秒级）
      const acquireCount = acquireWaits.length
      const acquireMedianMs = round2(percentile(acquireWaits, 50))
      const acquireP95Ms = round2(percentile(acquireWaits, 95))
      const acquireMaxMs = acquireCount === 0 ? 0 : round2(Math.max(...acquireWaits))
      const acquireWaitedRatio = acquireCount === 0
        ? 0
        : acquireWaits.filter(ms => ms > 1).length / acquireCount

      // 主判定：只按「取连接等待」与计划 §4.2 的 50ms 阈值（p95 / max），
      // 不掺 e2e 指标 —— 后者包含测试客户端（supertest 每请求起临时 server）的固定开销。
      const verdict = acquireP95Ms > P95_THRESHOLD_MS || acquireMaxMs > P95_THRESHOLD_MS
        ? '触发预案候选（同请求多 repo 合流共享事务，独立批次立项；回填计划 §4.2 时人工确认）'
        : '维持现状（每 CRUD 隐式事务）'
      // E2E 口径仅诊断：含测试客户端开销，不用于阈值判定
      const verdictE2E = `（含测试客户端开销，仅诊断，不用于阈值判定）${
        queuedRatio > QUEUED_RATIO_THRESHOLD || burstP95Ms > P95_THRESHOLD_MS
          ? '触发预案候选'
          : '维持现状'}`

      const metrics = {
        at: new Date().toISOString(),
        endpoint: 'POST /app/demo/list',
        poolMax,
        concurrency,
        poolTotalAfterWarmup,
        samples: samples.length,
        baselineMedianMs,
        baselineP95Ms,
        controlP95Ms,
        burstMedianMs,
        burstP95Ms,
        burstOverControlMs: round2(burstP95Ms - controlP95Ms),
        waitingPeak,
        totalPeak,
        inUsePeak,
        idleMin,
        waitingSampleRatioPercent: round2(waitingSampleRatio * 100),
        acquireCount,
        acquireMedianMs,
        acquireP95Ms,
        acquireMaxMs,
        acquireWaitedRatioPercent: round2(acquireWaitedRatio * 100),
        queuedRequests: queued,
        queuedRatioPercent: round2(queuedRatio * 100),
        thresholds: {
          p95Ms: P95_THRESHOLD_MS,
        },
        verdict,
        verdictE2E,
      }

      // 实测数字原样进测试输出（报告/计划回填都从这里取）
      console.info(`[pool-spike] ${JSON.stringify(metrics)}`)

      // ---- 3. 从宽断言：全部请求最终 2xx/业务 20000，无 5xx ----
      expect(rejected.map(result => String((result).reason))).toEqual([])
      expect(samples.length).toBeGreaterThan(0)
      expect(responses).toHaveLength(concurrency)
      // 宽上限：预期每请求恰 1 次取连接（本路径）；超过 2× 说明出现未预期的多次
      // 取连接（口径失效），而不是连接排队本身 —— 不以池大小硬编码。
      expect(acquireCount).toBeLessThanOrEqual(concurrency * 2)

      const failures = responses
        .map(res => ({ status: res.status, code: bodyOf(res).code }))
        .filter(({ status, code }) => status !== 200 || code !== WalnutAdminConstAppResponseCode.SUCCESS)
      expect(failures).toEqual([])
    }
    finally {
      await deleteDemoRows()
    }
  })
})
