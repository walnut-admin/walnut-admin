import type { WalnutLockService } from '@walnut-server/lock'
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppTechCacheLockService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookieString } from '@walnut-server/cookie'
import { WalnutAdminExceptionUserLocked } from '@walnut-server/exceptions/business/auth'
import { SysUserLockService } from '@walnut-server/identity'
import { WALNUT_ADMIN_LOCK } from '@walnut-server/lock'
import { isNil } from 'lodash'

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
    @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    // Step 1: 检查是否为免锁定端点
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

    // Step 3: 从 request 获取 deviceId（由 Device Guard 挂载）
    //
    // review-guards P1：旧写法是 `if (deviceId === null)` —— 这个分支**永不命中**：
    // `getWalnutAdminCookie` 缺省返回的是 **undefined**（cookie 不存在时），而
    // cookie-parser 对「带 s: 前缀但签名错」的畸形值返回 **false**。两者都不是 null，
    // 于是 undefined / false 会被继续拿去拼 `APP:MURLOCK:LOCK_GUARD:<userId>:<undefined>`
    // 与锁缓存键 `...:<deviceId>` —— 所有"没有设备凭据"的请求共用同一个退化键空间查锁，
    // 只要那个键上恰好是「已锁定」，无凭据的请求就会被误判成 40606。
    // 现在按 isNil 语义判，并把 false / 空串一并归一成"没有"。
    const deviceId = getWalnutAdminCookieString(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    if (isNil(deviceId)) {
      this.logger.debug('Lock check skipped: device ID not found in cookies')
      return true
    }

    // Step 4: 检查缓存
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

    return this.lockService.runWithLock(
      lockKey,
      3000, // 3秒锁超时
      async () => {
        // Double-check: 再次检查缓存（可能其他 Request 已经设置）
        const doubleCheckCache = await this.lockCacheService.checkIsLocked(user.userId, deviceId)
        if (doubleCheckCache !== null) {
          if (doubleCheckCache) {
            this.logger.warn(`User locked (from double-check cache): userId=${user.userId}, deviceId=${deviceId}`)
            throw new WalnutAdminExceptionUserLocked()
          }
          this.logger.debug(`User unlocked (from double-check cache): userId=${user.userId}, deviceId=${deviceId}`)
          return true
        }

        // 从数据库获取锁定状态
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
