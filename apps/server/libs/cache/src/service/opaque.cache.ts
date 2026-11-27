import { Injectable, Logger } from '@nestjs/common'
import {
  WalnutAdminConstAppCacheKeys,
  WalnutAdminConstAppCacheType,
} from '@walnut-server/const/app/cache'
import { AppTechCacheService } from '../cache.service'

/**
 * OPAQUE 缓存流的命名空间。
 *
 * L1（2026-11-27）：锁屏兜底验证（`/system/user/lock/verify/*`）复用登录的
 * `startLogin` / `finishLogin` 内核 —— 两条流在同一 `(userName, deviceId)` 上
 * 都写 30s TTL 的 `SERVER_STATE`，不隔离就会互相覆盖（用户点「忘记锁屏密码」的
 * 同时另一个标签页在登录 ⇒ 各自拿到对方的 state、双双 40103）。
 * `login` 保持**原键形**（既有清理/测试语义零变化）；`unlock` 追加 `:UNLOCK`。
 */
export type IOpaqueCacheScope = 'login' | 'unlock'

@Injectable()
export class AppTechCacheOpaqueService {
  private readonly logger = new Logger(AppTechCacheOpaqueService.name)

  constructor(private readonly cacheService: AppTechCacheService) {}

  private scopeSuffix(scope: IOpaqueCacheScope) {
    return scope === 'login' ? '' : ':UNLOCK'
  }

  private getOpaqueServerStateCacheKey(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope,
  ) {
    return `${WalnutAdminConstAppCacheKeys.AUTH_OPAQUE_STATE}:${userName}:${deviceId}:SERVER_STATE${this.scopeSuffix(scope)}`
  }

  /**
   * @description set OPAQUE server state cache
   */
  async setOpaqueServerStateCache(
    userName: string,
    deviceId: string,
    payload: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId, scope)
    await this.cacheService.set(cacheKey, payload, {
      t: WalnutAdminConstAppCacheType.AUTH,
      ttl: 30,
    })
    this.logger.debug(`Set OPAQUE server state cache: key => ${cacheKey}`)
  }

  /**
   * @description delete OPAQUE server state cache
   */
  async delOpaqueServerStateCache(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId, scope)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete OPAQUE server state cache: key => ${cacheKey}`)
  }

  /**
   * @description get OPAQUE server state cache
   */
  async getOpaqueServerStateCache(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId, scope)
    this.logger.debug(`Get OPAQUE server state cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }

  private getOpaqueSessionKeyCacheKey(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope,
  ) {
    return `${WalnutAdminConstAppCacheKeys.AUTH_OPAQUE_STATE}:${userName}:${deviceId}:SESSION_KEY${this.scopeSuffix(scope)}`
  }

  /**
   * @description set OPAQUE session key cache
   */
  async setOpaqueSessionKeyCache(
    userName: string,
    deviceId: string,
    payload: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId, scope)
    await this.cacheService.set(cacheKey, payload, {
      t: WalnutAdminConstAppCacheType.AUTH,
      ttl: 30,
    })
    this.logger.debug(`Set OPAQUE session key cache: key => ${cacheKey}`)
  }

  /**
   * @description delete OPAQUE session key cache
   */
  async delOpaqueSessionKeyCache(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId, scope)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete OPAQUE session key cache: key => ${cacheKey}`)
  }

  /**
   * @description get OPAQUE session key cache
   */
  async getOpaqueSessionKeyCache(
    userName: string,
    deviceId: string,
    scope: IOpaqueCacheScope = 'login',
  ) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId, scope)
    this.logger.debug(`Get OPAQUE session key cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }
}
