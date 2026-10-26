import type { NestExpressApplication } from '@nestjs/platform-express'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

/**
 * APP:SETTING 缓存的测试期改写（functional guard 系列）：
 *
 * functional guard（`WalnutAdminGuardFunctional` / OtpFunctionalGuard 等）读的是
 * Redis 里的 `WALNUT_CACHE_APP:SETTING`（{ settingKey → settingValue } 整对象）——
 * 缓存缺失时放行（缺省功能全开），有键且 `+value !== 1` 时抛 EndPointUnavailable（50300）。
 * 集成库 migrations 只建结构不落数据，`app_setting` 空表 → 默认现场是「缓存缺失或
 * 空对象 = 功能全开」，因此「关闭态」用例必须显式种缓存。
 *
 * `overrideAppSettings` 返回还原函数：把改动前的原值（可能是 null）原样写回，
 * 供 afterEach/afterAll 调用 —— 不碰 app_setting 表，只动缓存，跨轮零残留。
 */

/** 读取当前 APP:SETTING 缓存原值（缺失时为 null） */
export async function readAppSettingsCache(app: NestExpressApplication): Promise<Record<string, string> | null> {
  return app.get(AppTechCacheAppSettingsService).getAppSettings() ?? null
}

/**
 * 合并改写 APP:SETTING 缓存（浅合并到当前值上），返回异步还原函数。
 * 写入选项与 `extractAppSettingIntoCache` 同款（BUILT_IN 类型、无 TTL —— 与生产
 * extract 路径逐字对齐，guard 读到的一定是同一条通道的数据）。
 */
export async function overrideAppSettings(
  app: NestExpressApplication,
  patch: Record<string, string>,
): Promise<() => Promise<void>> {
  const service = app.get(AppTechCacheAppSettingsService)
  const original = await service.getAppSettings()

  const merged = { ...((original ?? {}) as Record<string, string>), ...patch }
  await service.setAppSettings(merged, { t: WalnutAdminConstAppCacheType.BUILT_IN })

  return async () => {
    if (original === null) {
      // 原现场缓存缺失：删键回到缺失态（AppTechCacheService.del 自带 WALNUT_CACHE_ 前缀）
      await app.get(AppTechCacheService).del(WalnutAdminConstAppCacheKeys.APP_SETTING)
    }
    else {
      await service.setAppSettings(original, { t: WalnutAdminConstAppCacheType.BUILT_IN })
    }
  }
}
