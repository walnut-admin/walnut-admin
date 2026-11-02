import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppTechCacheService } from '../cache.service'

// 缓存键模板
function LOCK_KEY_DEVICE(userId: string, deviceId: string) {
  return `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId}:${deviceId}`
}

function LOCK_KEY_GLOBAL(userId: string) {
  return `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId}:global`
}

@Injectable()
export class AppTechCacheLockService {
  private readonly logger = new Logger(AppTechCacheLockService.name)

  constructor(private readonly cache: AppTechCacheService) {}

  /**
   * 设置设备锁定状态缓存
   * @param userId 用户ID
   * @param deviceId 设备ID
   * @param crossDevice 是否跨设备锁定
   * @param isLocked 是否锁定
   */
  async setDeviceLockCache(
    userId: string,
    deviceId: string,
    crossDevice: boolean,
    isLocked: boolean,
  ): Promise<void> {
    if (crossDevice) {
      // 跨设备：设置全局锁定状态
      const key = LOCK_KEY_GLOBAL(userId)
      this.logger.debug(`Set global lock cache for user ${userId}: ${isLocked}`)
      await this.cache.set(key, isLocked, {
        t: WalnutAdminConstAppCacheType.BUILT_IN,
      })
    }
    else {
      // 单设备：设置特定设备锁定状态
      const key = LOCK_KEY_DEVICE(userId, deviceId)
      this.logger.debug(`Set device lock cache for user ${userId}, device ${deviceId}: ${isLocked}`)
      await this.cache.set(key, isLocked, {
        t: WalnutAdminConstAppCacheType.BUILT_IN,
      })
    }
  }

  /**
   * 检查设备是否被锁定
   * 优先级：全局锁定 > 单设备锁定
   * @param userId 用户ID
   * @param deviceId 设备ID
   * @returns 是否锁定
   */
  // P1-20 修复（2026-10-29）：两键都缺失时返回 **null**（语义 = 缓存未命中），不再
  // 折叠成 false。锁守卫以 `!== null` 判定缓存命中、miss 时回源 DB；旧实现恒返回
  // boolean 让 DB 回源分支成为死代码 —— Redis 清空/淘汰后锁定状态被静默当作
  // 「未锁定」放行。返回值类型随之放宽为 boolean | null。
  async checkIsLocked(userId: string, deviceId: string): Promise<boolean | null> {
    // 1. 检查全局锁定状态
    const globalKey = LOCK_KEY_GLOBAL(userId)
    const globalLocked = await this.cache.get<boolean>(globalKey)
    if (globalLocked !== null) {
      return globalLocked
    }

    // 2. 检查单设备锁定状态（null = 两键都未命中，交守卫回源 DB）
    const deviceKey = LOCK_KEY_DEVICE(userId, deviceId)
    return this.cache.get<boolean>(deviceKey)
  }

  /**
   * 清除用户的所有锁定缓存（可选，用于清理）
   * @param userId 用户ID
   */
  async clearUserLockCache(userId: string): Promise<void> {
    const pattern = `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId}:*`
    // 注意：这里需要你的 cache service 支持 pattern 删除
    // 如果不支持，可以在设置时记录所有 deviceId，然后逐个删除
    this.logger.debug(`Clear all lock cache for user ${userId}`)
    await this.cache.delByPattern(pattern)
  }
}
