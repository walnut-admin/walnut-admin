import type { Recordable } from 'easy-fns-ts'
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

/**
 * 「已验证过登录口令」的解锁授权缓存键（sensitive_op 同款：`<uid>:<did>` + TTL + JSON）。
 *
 * 追加在设备锁键**之后**而不是 `SECURITY:LOCK:UNLOCK_AUTH:<uid>:<did>`：`clearUserLockCache`
 * 的 pattern 是 `SECURITY:LOCK:<userId>:*`，只有这个形态会被它一并清掉；同时与设备锁键
 * `SECURITY:LOCK:<uid>:<did>` 不同键，不会污染 `checkIsLocked` 的精确读。
 */
function LOCK_KEY_UNLOCK_AUTH(userId: string, deviceId: string) {
  return `${LOCK_KEY_DEVICE(userId, deviceId)}:UNLOCK_AUTH`
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
      // 先清本设备的旧键（跨设备读序里全局键优先，但切回单设备的写入会以本键为准 ——
      // 别让「跨设备时代的旧值」在切换窗口里被读到）
      await this.cache.del(LOCK_KEY_DEVICE(userId, deviceId))
      this.logger.debug(`Set global lock cache for user ${userId}: ${isLocked}`)
      await this.cache.set(key, isLocked, {
        t: WalnutAdminConstAppCacheType.BUILT_IN,
      })
    }
    else {
      // D1 修复（2026-11-27）：跨设备 → 单设备切换后 **fail-open**。
      // `checkIsLocked` 先读全局键且全局键无 TTL；旧实现切到设备键时不清全局，
      // 于是曾用过跨设备锁（DB 默认 true）的用户关掉 lockCrossDevice 置锁后，
      // 残留的 `global=false` 抢先返回 ⇒ 锁屏静默失效。
      //
      // 顺序刻意是「先删两键、再写本键」：任何中间态都是**缓存未命中**（守卫回源 DB、
      // fail-closed），而不会读到「全局旧 false + 设备键还没写」这种假放行。
      await this.cache.del(LOCK_KEY_GLOBAL(userId))
      await this.cache.del(LOCK_KEY_DEVICE(userId, deviceId))

      const key = LOCK_KEY_DEVICE(userId, deviceId)
      this.logger.debug(`Set device lock cache for user ${userId}, device ${deviceId}: ${isLocked}`)
      await this.cache.set(key, isLocked, {
        t: WalnutAdminConstAppCacheType.BUILT_IN,
      })
    }
  }

  /**
   * 写入「登录口令已验证」的解锁授权（fallback verify 成功后调用）。
   *
   * 只给**短时重试**兜底：verify/finish 已就地解锁，若响应在网络上丢失、客户端拿不到
   * 结果，接着调 `PATCH lock/unlock`（不带锁屏密码）时可凭这枚授权完成解锁 —— 单次消费
   * （见 `consumeUnlockAuthCache`）、设备作用域、60 秒 TTL。
   */
  async setUnlockAuthCache(userId: string, deviceId: string, payload: Recordable): Promise<void> {
    const key = LOCK_KEY_UNLOCK_AUTH(userId, deviceId)
    this.logger.debug(`Set unlock auth cache for user ${userId}, device ${deviceId}`)
    await this.cache.set(key, payload, {
      t: WalnutAdminConstAppCacheType.BUILT_IN,
      ttl: 60,
    })
  }

  /**
   * 读取并删除解锁授权（单次消费；不存在返回 null）。
   */
  async consumeUnlockAuthCache<T = Recordable>(userId: string, deviceId: string): Promise<T | null> {
    const key = LOCK_KEY_UNLOCK_AUTH(userId, deviceId)
    const payload = await this.cache.get<T>(key)

    if (payload !== null) {
      await this.cache.del(key)
    }

    return payload
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
