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

import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys, WalnutAdminConstDeviceCookieMaxAge } from '@walnut-server/const/app/cookie'
import { AppTechCookieService, getWalnutAdminCookie } from '@walnut-server/cookie'
import { WalnutAdminExceptionDeviceBanned, WalnutAdminExceptionDeviceLocked, WalnutAdminExceptionDeviceNotAcceptable } from '@walnut-server/exceptions/base/406'
import { WALNUT_ADMIN_LOCK } from '@walnut-server/lock'
import { SysDeviceRepositoryService } from '@walnut-server/system'

const WalnutAdminConstDecoratorDeviceFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_DEVICE_FREE')

export function WalnutAdminGuardDeviceFree() {
  return SetMetadata(WalnutAdminConstDecoratorDeviceFreeKey, true)
}

@Injectable()
export class WalnutAdminGuardDevice implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardDevice.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheDeviceService: AppTechCacheDeviceService,
    private readonly deviceRepo: SysDeviceRepositoryService,
    @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
    private readonly cookieService: AppTechCookieService,
  ) { }

  /**
   * P0-1（设备 cookie 死锁）后端纵深：**DEVICE_ID cookie 滑动续期**。
   *
   * 背景：cookie 原先只在 `/system/device/initial` 写一次（30 天 maxAge、无续期），而前端
   * 的 `setupDeviceId` 只看 localStorage（有值就再也不 initial）⇒ 第 31 天起 cookie 消失、
   * 全站 40605，登录端点也在 DeviceGuard 之后 ⇒ 连重新登录都做不到（前端那一半的修复是
   * 40605 自愈，见 admin 的 response 拦截器）。
   *
   * 这里做「校验命中即检查续期窗口」：续期窗口（`SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`，
   * TTL = 有效期的 80%）已过就重发 cookie 把 maxAge 拉满，于是 cookie 的剩余寿命恒
   * > 20%，永远不会走到 0。写 cookie 走 AppTechCookieService（与 initial 同一条腿、
   * 同签名/同属性），不新增旁路。
   *
   * 只在**校验全通过**之后调用：被封禁/锁定的设备不该拿到新的 cookie。
   */
  private async renewDeviceCookieIfNeeded(request: IWalnutAdminExpressRequest, deviceId: string) {
    const shouldRenew = await this.cacheDeviceService.markDeviceCookieRenewed(deviceId)

    if (!shouldRenew) {
      return
    }

    this.cookieService.setResponseCookie(request, [
      {
        key: WalnutAdminConstCookieKeys.DEVICE_ID,
        value: deviceId,
        options: {
          maxAge: WalnutAdminConstDeviceCookieMaxAge,
        },
      },
    ])

    this.logger.debug(`Device cookie renewed (sliding): ${deviceId}`)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const deviceFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorDeviceFreeKey,
      [context.getHandler(), context.getClass()],
    )

    if (deviceFree) {
      this.logger.debug('Device check bypassed for device-free endpoint')
      return true
    }

    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    if (!deviceId) {
      this.logger.warn('Device ID not found in cookies')
      throw new WalnutAdminExceptionDeviceNotAcceptable()
    }

    // F-44：噪声过滤，**不是安全边界** —— isPostman 已被 isDev 门住（生产恒 false），权威说明见 apps/api/src/middleware/src/user-agent.middleware.ts 的 isPostmanRuntimeRequest。
    if (request.isPostman) {
      this.logger.debug('Postman runtime request, bypassed device check')
      return true
    }

    const cachedDevice = await this.cacheDeviceService.getSysDeviceCache(deviceId)

    // P2-2：缓存 miss 时回源库（sys_device.locked / banned 是落库真值），命中后回填
    // 缓存再走同一判定链 —— 缓存被清空/过期不再等价于「设备不存在」，也不放行。
    let deviceState = cachedDevice

    if (!deviceState) {
      const dbDevice = await this.deviceRepo.findDeviceByDeviceId(deviceId)

      if (!dbDevice) {
        this.logger.warn(`Device not found in cache or database: ${deviceId}`)
        throw new WalnutAdminExceptionDeviceNotAcceptable()
      }

      this.logger.debug(`Device cache miss, hydrated from database: ${deviceId}`)
      await this.cacheDeviceService.setSysDeviceCache(dbDevice)

      deviceState = {
        locked: dbDevice.locked,
        banned: dbDevice.banned,
        active: dbDevice.active,
        currentIp: dbDevice.ip as string,
      }
    }

    if (deviceState.currentIp && request.realIp && deviceState.currentIp !== request.realIp) {
      this.logger.warn(`Device IP changed: ${deviceId}`)
      const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:DEVICE:IP_CHANGE:${deviceId}`
      await this.lockService.runWithLock(
        lockKey,
        200,
        async () => {
          const latest = await this.cacheDeviceService.getSysDeviceCache(deviceId)

          if (latest?.currentIp !== request.realIp) {
            await this.deviceRepo.updateIpAndLocation(deviceId, request.realIp)
          }
        },
      )
    }

    if (deviceState.banned) {
      this.logger.warn(`Device banned: ${deviceId}`)
      throw new WalnutAdminExceptionDeviceBanned()
    }

    if (deviceState.locked) {
      this.logger.warn(`Device locked: ${deviceId}`)
      throw new WalnutAdminExceptionDeviceLocked()
    }

    // P0-1：校验全通过后按续期窗口重发 cookie（被封禁/锁定的设备走不到这里）
    await this.renewDeviceCookieIfNeeded(request, deviceId)

    this.logger.debug(`Device validated successfully: ${deviceId}`)
    return true
  }
}
