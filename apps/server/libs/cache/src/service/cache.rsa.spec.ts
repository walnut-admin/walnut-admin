import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionRsaPubKeyNotFound } from '@walnut-server/exceptions/business/rsa'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { describe, expect, it, vi } from 'vitest'

import { AppTechCacheRsaService } from './cache.rsa'

/**
 * P0（2026-11）回归钉子：`getRsaPubKeyCache` 必须 **await** 底层的 async `get`。
 *
 * 修复前的写法是 `const cached = this.cacheService.get(...)`（无 await）⇒ `cached` 是 Promise，
 * `isNil(Promise)` 恒 false ⇒ 40012 永不触发；async 函数又把那个 Promise 采纳成返回值，
 * 于是缓存缺失时调用方拿到 `null` 而不是异常 —— 两处"握手已完成"守卫
 * （sign guard 与 sign.service 的 await 调用）全部空转，客户端也永远走不到
 * 「重新登记公钥」的恢复分支（表现为启动错误屏）。
 *
 * 第一条用例就是判据：**把 await 去掉，它必红**（thrown 变成 null）——
 * 已在 fix-p0.md 里留了「改回旧写法 → 红 → 还原 → 绿」的实测输出。
 */

interface ISetCall {
  key: string
  value: unknown
  options: { t: string, ttl: number }
}

function createService(redisMap: Map<string, unknown>) {
  const getSpy = vi.fn(async (key: string) => redisMap.get(key) ?? null)
  // 第三个参数显式声明：vi.fn 的参数表决定 mock.calls 的元组形态，
  // 少了它就取不到 options（TS2352 那次就是这么红的）
  const setCalls: ISetCall[] = []
  const setSpy = vi.fn(async (key: string, value: unknown, options: ISetCall['options']) => {
    setCalls.push({ key, value, options })
    redisMap.set(key, value)
  })
  const cacheService = { get: getSpy, set: setSpy } as unknown as ConstructorParameters<typeof AppTechCacheRsaService>[0]

  return { service: new AppTechCacheRsaService(cacheService), getSpy, setSpy, setCalls }
}

function cacheKeyOf(deviceId: string) {
  return `${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`
}

function errCodeOf(error: unknown): number {
  // 与 pipes.spec.ts 同款：errCode 形态由 WalnutAdminExceptionBadRequest 基类保证
  const response = (error as { getResponse: () => unknown }).getResponse() as { errCode: number }
  return response.errCode
}

describe('rsa pub key cache：P0 回归（await 与 40012）', () => {
  it('缓存缺失 ⇒ 抛 40012（把 await 去掉本用例必红）', async () => {
    const { service } = createService(new Map())

    const thrown: unknown = await service.getRsaPubKeyCache('device-missing').then(
      () => null,
      (error: unknown) => error,
    )

    expect(thrown).toBeInstanceOf(WalnutAdminExceptionRsaPubKeyNotFound)
    expect(errCodeOf(thrown)).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND)
  })

  it('缓存命中 ⇒ 原样返回 PEM 字符串（不是 Promise 包装）', async () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAK0=\n-----END PUBLIC KEY-----'
    const { service, getSpy } = createService(new Map([[cacheKeyOf('device-hit'), pem]]))

    const got = await service.getRsaPubKeyCache('device-hit')

    expect(got).toBe(pem)
    expect(typeof got).toBe('string')
    expect(getSpy).toHaveBeenCalledTimes(1)
  })

  it('写入：AUTH 分类 + 30 天 TTL，键与读取同一形状', async () => {
    const { service, setSpy, setCalls } = createService(new Map())

    await service.setRsaPubKeyCache('device-set', 'PEM')

    expect(setSpy).toHaveBeenCalledTimes(1)
    const call = setCalls[0]
    expect(call.key).toBe(cacheKeyOf('device-set'))
    expect(call.value).toBe('PEM')
    expect(call.options.t).toBe(WalnutAdminConstAppCacheType.AUTH)
    expect(call.options.ttl).toBe(30 * 24 * 3600)
  })
})
