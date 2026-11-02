import type { IWalnutAdminTokenTtl } from '../token-ttl.port'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { Role } from '@walnut/contract'
import { AppTechCacheService } from '../cache.service'
import { WALNUT_ADMIN_TOKEN_TTL } from '../token-ttl.port'

@Injectable()
export class AppTechCachePermissionsService {
  private readonly logger = new Logger(AppTechCachePermissionsService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    @Inject(WALNUT_ADMIN_TOKEN_TTL) private readonly tokenService: IWalnutAdminTokenTtl,
  ) {}

  private getPermissionCacheKey(userId: string, deviceId: string) {
    return `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${userId}:${deviceId}`
  }

  // get permission strings from cache
  async getPermissionsFromCache(userId: string, deviceId: string) {
    return this.cacheService.get<string[]>(
      this.getPermissionCacheKey(userId, deviceId),
    )
  }

  // set permission strings to cache
  async setPermissions(
    user: IWalnutAdminAccessTokenPayload,
    deviceId: string,
    permissions: string[],
  ) {
    // visitor no need to set permission cache
    if (user.currentRoleName === Role.VISITOR) {
      return
    }

    this.logger.debug(
      `set permissions cache, userId: ${user.userId}, permissions count: ${permissions.length}`,
    )

    // P1-15（2026-10-28）：set 的 ttl 单位是秒（cache.service 直接 redis.setEx），
    // 旧实现 `atTtl * 1000` 让 30 分钟的 AT 权限缓存实际驻留 ~20.8 天。与 AT 同寿命。
    const atTtl = this.tokenService.getAccessTokenExpireSeconds()

    // set permissions into cache
    await this.cacheService.set(
      this.getPermissionCacheKey(user.userId, deviceId),
      permissions,
      {
        ttl: atTtl,
        t: WalnutAdminConstAppCacheType.AUTH,
      },
    )
  }

  async delPermissions(token: string, deviceId: string) {
    await this.cacheService.del(this.getPermissionCacheKey(token, deviceId))
  }

  /**
   * @description 失效某用户**全部设备**的权限缓存（P1-18 / P2-16：角色整组替换、
   * 当前角色校正、角色授权/状态变更 —— 缓存键按 `<userId>:<deviceId>` 分布，
   * 服务端没有反查设备的通道，按 pattern 一次清干净）。
   */
  async delPermissionsForUser(userId: string) {
    const deleted = await this.cacheService.delByPattern(`${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${userId}:*`)
    this.logger.debug(`del permissions cache for user ${userId}, keys=${deleted.length}`)
  }

  /**
   * @description 全量失效权限缓存（菜单维度变更：permission 列/菜单删除影响所有角色与
   * 用户，反查代价与正确性都不划算 —— 权限缓存可由客户端重新拉取 `/auth/permissions`
   * 重建，全清是明确取舍）。
   */
  async delAllPermissions() {
    const deleted = await this.cacheService.delByPattern(`${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:*`)
    this.logger.debug(`del all permissions cache, keys=${deleted.length}`)
  }
}
