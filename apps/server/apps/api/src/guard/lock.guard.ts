import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { WalnutAdminExceptionUserLocked } from '@walnut/exceptions/business/auth'
import { MurLockService } from 'murlock'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { SysUserLockService } from '@/modules/system/user_lock/user_lock.service'
import { AppTechCacheLockService } from '@/modules/techniques/cache/service/cache.lock'

const WalnutAdminConstDecoratorLockKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_LOCK_FREE')

export function WalnutAdminGuardLockFree() {
  return SetMetadata(WalnutAdminConstDecoratorLockKey, true)
}

@Injectable()
export class WalnutAdminGuardLock implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardLock.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly userLockService: SysUserLockService,
    private readonly lockCacheService: AppTechCacheLockService,
    private readonly murLockService: MurLockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    // Step 1: 检查是否为免锁定端�?
    const lockFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorLockKey,
      [context.getHandler(), context.getClass()],
    )
    if (lockFree) {
      this.logger.debug('Lock check bypassed for lock-free endpoint')
      return true
    }

    // Step 2: 验证Request中的用户信息
    const user = request.user
    if (!user) {
      this.logger.debug('Lock check skipped: user not found in request')
      return true
    }

    // Step 3: �?request 获取 deviceId（由 Device Guard 挂载�?
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    if (deviceId === null) {
      this.logger.debug('Lock check skipped: device ID not found in cookies')
      return true
    }

    // Step 4: 检查缓�?
    const cachedLockStatus = await this.lockCacheService.checkIsLocked(user.userId, deviceId)

    // 缓存命中
    if (cachedLockStatus !== null) {
      if (cachedLockStatus) {
        this.logger.warn(`User locked (from cache): userId=${user.userId}, deviceId=${deviceId}`)
        throw new WalnutAdminExceptionUserLocked()
      }
      this.logger.debug(`User unlocked (from cache): userId=${user.userId}, deviceId=${deviceId}`)
      return true
    }

    // Step 5: 缓存未命中，使用分布式锁防止缓存击穿
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:LOCK_GUARD:${user.userId}:${deviceId}`

    return this.murLockService.runWithLock(
      lockKey,
      3000, // 3秒锁超时
      async () => {
        // Double-check: 再次检查缓存（可能其他Request已经设置�?
        const doubleCheckCache = await this.lockCacheService.checkIsLocked(user.userId, deviceId)
        if (doubleCheckCache !== null) {
          if (doubleCheckCache) {
            this.logger.warn(`User locked (from double-check cache): userId=${user.userId}, deviceId=${deviceId}`)
            throw new WalnutAdminExceptionUserLocked()
          }
          this.logger.debug(`User unlocked (from double-check cache): userId=${user.userId}, deviceId=${deviceId}`)
          return true
        }

        // 从数据库获取锁定状�?
        this.logger.debug(`Cache miss, querying DB: userId=${user.userId}, deviceId=${deviceId}`)
        const lockInfo = await this.userLockService.getLockForGuard(user.userId, deviceId)

        // 回填缓存
        await this.lockCacheService.setDeviceLockCache(
          user.userId,
          deviceId,
          lockInfo.isCrossDevice,
          lockInfo.isLocked,
        )

        if (lockInfo.isLocked) {
          this.logger.warn(`User locked (from DB): userId=${user.userId}, deviceId=${deviceId}, crossDevice=${lockInfo.isCrossDevice}`)
          throw new WalnutAdminExceptionUserLocked()
        }

        this.logger.debug(`User unlocked (from DB): userId=${user.userId}, deviceId=${deviceId}`)
        return true
      },
    )
  }
}
