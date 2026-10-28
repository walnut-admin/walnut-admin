import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { describe, expect, it, vi } from 'vitest'

import { AppTechCacheAppSettingsService } from './cache.appSettings'

// L3 配套单测：appSettings 读取 memo 化（进程内缓存）后的语义钉子 ——
// 1. memo 命中不再打 Redis；2. setAppSettings 写后同进程读立即见新值（失效生效）；
// 3. null 不入 memo（Redis 未预热/被清空可自愈）；4. 解析失败走默认值且不污染 memo。

function createService(redisMap: Map<string, unknown>) {
  const getSpy = vi.fn(async (key: string) => redisMap.get(key) ?? null)
  const setSpy = vi.fn(async (key: string, value: unknown) => {
    redisMap.set(key, value)
  })
  const cacheService = { get: getSpy, set: setSpy } as unknown as ConstructorParameters<typeof AppTechCacheAppSettingsService>[0]

  return { service: new AppTechCacheAppSettingsService(cacheService), getSpy }
}

function seedKey(value: unknown) {
  return { [WalnutAdminConstAppSettingKeys.APP_AUTH_EMAIL]: JSON.stringify(value) }
}

describe('appSettings cache service：L3 进程内 memo', () => {
  it('getSetting：首次走 Redis GET + parse，二次命中 memo 不再打 Redis', async () => {
    const redisMap = new Map([[WalnutAdminConstAppCacheKeys.APP_SETTING, seedKey({ authEnable: 1 })]])
    const { service, getSpy } = createService(redisMap)

    const first = await service.getAuthEmailConfig()
    expect(first.authEnable).toBe(1)
    expect(getSpy).toHaveBeenCalledTimes(1)

    const second = await service.getAuthEmailConfig()
    expect(second.authEnable).toBe(1)
    expect(getSpy).toHaveBeenCalledTimes(1)
  })

  it('setAppSettings 写后失效：同进程读立即见新值（不读旧 memo）', async () => {
    const redisMap = new Map([[WalnutAdminConstAppCacheKeys.APP_SETTING, seedKey({ authEnable: 0 })]])
    const { service } = createService(redisMap)

    await expect(service.getAuthEmailConfig()).resolves.toMatchObject({ authEnable: 0 })

    // 写路径（extractAppSettingIntoCache 同款调用面）换上新值
    await service.setAppSettings(seedKey({ authEnable: 1 }), { t: WalnutAdminConstAppCacheType.BUILT_IN })

    await expect(service.getAuthEmailConfig()).resolves.toMatchObject({ authEnable: 1 })
  })

  it('getAppSettings：memo 命中不发 Redis；null 不入 memo（删 key 后可自愈）', async () => {
    const redisMap = new Map<string, unknown>()
    const { service, getSpy } = createService(redisMap)

    // 冷读：null（不抛错，消费端 guard 按「cache missing」放行）
    await expect(service.getAppSettings()).resolves.toBeNull()
    expect(getSpy).toHaveBeenCalledTimes(1)

    // 二次读：null 未被 memo，仍打 Redis（自愈通道）
    await expect(service.getAppSettings()).resolves.toBeNull()
    expect(getSpy).toHaveBeenCalledTimes(2)

    // Redis 里出现值后（外部预热/他通道写入），下次读拿到并 memo
    redisMap.set(WalnutAdminConstAppCacheKeys.APP_SETTING, seedKey({ authEnable: 1 }))
    await expect(service.getAppSettings()).resolves.toMatchObject(seedKey({ authEnable: 1 }))
    expect(getSpy).toHaveBeenCalledTimes(3)

    await expect(service.getAppSettings()).resolves.toMatchObject(seedKey({ authEnable: 1 }))
    expect(getSpy).toHaveBeenCalledTimes(3)
  })

  it('getSetting：值缺失/坏 JSON → 默认值兜底，且不把失败结果写进 memo', async () => {
    const redisMap = new Map([[WalnutAdminConstAppCacheKeys.APP_SETTING, { [WalnutAdminConstAppSettingKeys.APP_AUTH_MFA]: 'not-json' }]])
    const { service } = createService(redisMap)

    const fallback = await service.getAuthMfaConfig()
    expect(fallback).toEqual({ methodsRequiredCount: 1 })

    // 走真实写路径（setAppSettings 会清 memo）修复数据后，同 key 重读不再落默认值
    await service.setAppSettings(
      { [WalnutAdminConstAppSettingKeys.APP_AUTH_MFA]: JSON.stringify({ methodsRequiredCount: 2 }) },
      { t: WalnutAdminConstAppCacheType.BUILT_IN },
    )
    await expect(service.getAuthMfaConfig()).resolves.toEqual({ methodsRequiredCount: 2 })
  })
})
