import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { Role } from '@walnut/contract'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

@Injectable()
export class AppTechCachePermissionsService {
  private readonly logger = new Logger(AppTechCachePermissionsService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly tokenService: AppTokenService,
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
}
