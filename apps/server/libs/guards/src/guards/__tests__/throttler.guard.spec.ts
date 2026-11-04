import type { ExecutionContext } from '@nestjs/common'
import type { ModuleRef } from '@nestjs/core'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { WalnutAdminDecoratorThrottle, WalnutAdminGuardThrottler } from '../throttler.guard'

/**
 * throttler.guard.ts:44-80 —— 动态 `ttl` / `blockDuration` 覆盖（P1-10，2026-10-28 修复）
 *
 * 观测点只有一个：`ThrottlerStorage.increment(key, ttl, limit, blockDuration, name)` 的入参。
 * 这是 `handleRequest` 唯一的下游副作用（超限判定/封禁窗口都在 storage 里算），所以断言
 * 落在它上面等价于断言「守卫最终交给了 storage 什么」。
 *
 * | 场景 | limit | ttl | blockDuration | 为什么钉这个 |
 * |------|-------|-----|---------------|--------------|
 * | 无装饰器（全局默认桶） | 120 | 10000 | 10000 | 三个值原样下传，全局桶不被动态逻辑改写 |
 * | 装饰器 limit=4 / ttl=60（秒） | 4 | 60000 | **60000** | P1-10：blockDuration 必须跟动态 ttl 同步 |
 * | 动态 ttl = NaN | 4 | 10000 | 10000 | `Number.isFinite` 挡住坏配置，退回全局值（不写 NaN） |
 * | 动态 limit = Infinity | 120 | 60000 | 60000 | 两条覆盖互相独立：坏 limit 不拖累 ttl/blockDuration |
 * | 容器里取不到服务 | 120 | 10000 | 10000 | `isNil(service)` 整段跳过，不抛 |
 *
 * **负对照（第二行）**：修复前的行为是「只改 ttl、blockDuration 留全局 10000」
 * （throttler.guard.ts:41-43 的注释就是这条）。把第 66 行 `blockDuration = ttl` 删掉,
 * 「装饰器覆盖」用例的 `blockDuration` 断言立刻红 —— 那正是连发攻击者「block 过后每
 * 全局 ttl 又能再打 limit 发」的窗口。
 */

/** 全局默认桶：与 libs/throttle/src/throttler.service.ts:41-42 同形（ttl 秒 → 毫秒、limit 原值） */
const GLOBAL_TTL_MS = 10_000
const GLOBAL_LIMIT = 120

/** 未被装饰器标记的控制器（走全局默认桶） */
class GlobalOnlyController {
  handler(): void {}
}

/** 动态配置源（形态与 SecurityCapSettingService / SysDeviceSettingService 一致：两个 async getter） */
class DynamicThrottleSettingService implements IWalnutAdminThrottleConfigProvider {
  limit: number = 4
  ttlSeconds: number = 60

  readonly getThrottleLimit = vi.fn(async () => this.limit)

  readonly getThrottleTtl = vi.fn(async () => this.ttlSeconds)
}

/** 被装饰器标记的控制器（声明顺序必须在配置源之后：装饰器求值要拿到类本身） */
class DecoratedController {
  @WalnutAdminDecoratorThrottle(DynamicThrottleSettingService)
  handler(): void {}
}

interface IncrementCall {
  key: string
  ttl: number
  limit: number
  blockDuration: number
  name: string
}

interface Harness {
  guard: WalnutAdminGuardThrottler
  calls: IncrementCall[]
  context: ExecutionContext
}

interface HandlerCarrier {
  prototype: { handler: () => void }
}

/**
 * 取控制器的 handler 引用 —— 它只是 `@SetMetadata` 的元数据载体（Reflector 从函数上读），
 * 永不调用，所以不存在 this 绑定问题。
 */
function handlerOf(controller: HandlerCarrier): () => void {
  return controller.prototype.handler
}

/**
 * 装配一只真实守卫：真 `Reflector`（元数据走真实的 `SetMetadata`，不 mock 反射）、
 * 假 storage（只记入参）、假 `ModuleRef`（按 token 决定容器里有没有那个服务）。
 */
function createHarness(opts: {
  handler: () => void
  controller: unknown
  resolve: (token: unknown) => unknown
}): Harness {
  const calls: IncrementCall[] = []

  const storage = {
    increment: async (key: string, ttl: number, limit: number, blockDuration: number, name: string) => {
      calls.push({ key, ttl, limit, blockDuration, name })
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 }
    },
  }

  const guard = new WalnutAdminGuardThrottler(
    [{ ttl: GLOBAL_TTL_MS, limit: GLOBAL_LIMIT }],
    storage,
    new Reflector(),
    { get: opts.resolve } as unknown as ModuleRef,
  )

  const request = { headers: {}, ip: '10.0.0.1', realIp: '203.0.113.7' }
  const response = { header: (): void => undefined }

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => opts.handler,
    getClass: () => opts.controller,
  } as unknown as ExecutionContext

  return { guard, calls, context }
}

/**
 * 走完 `handleRequest`（守卫里覆盖的那一层）→ 基类 `ThrottlerGuard.handleRequest`
 * → 假 storage。requestProps 里的 `limit/ttl/blockDuration` 是 `canActivate` 算出来的
 * **全局值**（throttler.service.ts 的 120 / 10000），守卫要在这里做动态覆盖。
 */
async function runHandleRequest(harness: Harness): Promise<boolean> {
  await harness.guard.onModuleInit()

  return harness.guard.handleRequest({
    context: harness.context,
    limit: GLOBAL_LIMIT,
    ttl: GLOBAL_TTL_MS,
    blockDuration: GLOBAL_TTL_MS,
    throttler: { name: 'default', ttl: GLOBAL_TTL_MS, limit: GLOBAL_LIMIT },
    getTracker: (req: Record<string, unknown>) => String(req.realIp),
    generateKey: () => 'bucket-key',
  })
}

function setupDynamic(
  configure: (service: DynamicThrottleSettingService) => void,
): { harness: Harness, service: DynamicThrottleSettingService, resolve: ReturnType<typeof vi.fn> } {
  const service = new DynamicThrottleSettingService()
  configure(service)

  const resolve = vi.fn((token: unknown) => (token === DynamicThrottleSettingService ? service : undefined))
  const harness = createHarness({
    handler: handlerOf(DecoratedController),
    controller: DecoratedController,
    resolve,
  })

  return { harness, service, resolve }
}

describe('throttler guard：全局默认桶（无装饰器）', () => {
  it('limit / ttl / blockDuration 三个值原样下传，且不碰容器', async () => {
    const resolve = vi.fn(() => undefined)
    const harness = createHarness({
      handler: handlerOf(GlobalOnlyController),
      controller: GlobalOnlyController,
      resolve,
    })

    const allowed = await runHandleRequest(harness)

    expect(allowed).toBe(true)
    expect(harness.calls).toEqual([
      { key: 'bucket-key', ttl: GLOBAL_TTL_MS, limit: GLOBAL_LIMIT, blockDuration: GLOBAL_TTL_MS, name: 'default' },
    ])
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('throttler guard：装饰器动态覆盖（limit=4 / ttl=60s）', () => {
  it('limit 取动态值，ttl 与 blockDuration **同步**为动态 ttl×1000（P1-10 的修法）', async () => {
    const { harness } = setupDynamic((service) => {
      service.limit = 4
      service.ttlSeconds = 60
    })

    await runHandleRequest(harness)

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]).toMatchObject({ limit: 4, ttl: 60_000, blockDuration: 60_000 })
    // 负对照：修复前 blockDuration 恒为全局 10000（封禁窗口比 ttl 短 6 倍）
    expect(harness.calls[0].blockDuration).not.toBe(GLOBAL_TTL_MS)
    // 超限封禁窗口必须 ≥ 计数窗口：两者相等才是「同一轮攻击只被封一次」
    expect(harness.calls[0].blockDuration).toBe(harness.calls[0].ttl)
  })

  it('两个 getter 都被 await 调用（不是读一次缓存字段）', async () => {
    const { harness, service } = setupDynamic(() => undefined)

    await runHandleRequest(harness)

    expect(service.getThrottleLimit).toHaveBeenCalledTimes(1)
    expect(service.getThrottleTtl).toHaveBeenCalledTimes(1)
  })

  it('动态 ttl = NaN（配置读不到）⇒ ttl 与 blockDuration 都退回全局 10000，limit 仍按动态值', async () => {
    const { harness } = setupDynamic((service) => {
      service.ttlSeconds = Number.NaN
    })

    await runHandleRequest(harness)

    expect(harness.calls[0]).toMatchObject({ limit: 4, ttl: GLOBAL_TTL_MS, blockDuration: GLOBAL_TTL_MS })
  })

  it('动态 limit = Infinity（类型错/配置坏）⇒ limit 退回全局 120，ttl/blockDuration 仍按动态 30s', async () => {
    const { harness } = setupDynamic((service) => {
      service.limit = Number.POSITIVE_INFINITY
      service.ttlSeconds = 30
    })

    await runHandleRequest(harness)

    expect(harness.calls[0]).toMatchObject({ limit: GLOBAL_LIMIT, ttl: 30_000, blockDuration: 30_000 })
  })

  it('容器里取不到被装饰的服务（moduleRef.get → undefined）⇒ 整段跳过、不抛，三个值保持全局', async () => {
    const resolve = vi.fn(() => undefined)
    const harness = createHarness({
      handler: handlerOf(DecoratedController),
      controller: DecoratedController,
      resolve,
    })

    await expect(runHandleRequest(harness)).resolves.toBe(true)

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(harness.calls[0]).toMatchObject({
      limit: GLOBAL_LIMIT,
      ttl: GLOBAL_TTL_MS,
      blockDuration: GLOBAL_TTL_MS,
    })
  })
})

describe('throttler guard：tracker 取 req.realIp', () => {
  it('tracker = realIp（XFF 派生），不是 express 的 req.ip —— 限流维度与 IP guard 同源', async () => {
    const harness = createHarness({
      handler: handlerOf(GlobalOnlyController),
      controller: GlobalOnlyController,
      resolve: () => undefined,
    })

    // 受保护方法：守卫把 tracker 从默认的 req.ip 改成 req.realIp（真实 IP 由 IpMiddleware 落）
    const readTracker = (harness.guard as unknown as {
      getTracker: (req: IWalnutAdminExpressRequest) => Promise<string>
    }).getTracker.bind(harness.guard)

    const tracker = await readTracker({
      ip: '10.0.0.1',
      realIp: '203.0.113.7',
    } as unknown as IWalnutAdminExpressRequest)

    expect(tracker).toBe('203.0.113.7')
    expect(tracker).not.toBe('10.0.0.1')
  })
})
