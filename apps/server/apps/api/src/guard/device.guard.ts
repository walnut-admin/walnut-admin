import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionDeviceBanned, WalnutAdminExceptionDeviceLocked, WalnutAdminExceptionDeviceNotAcceptable } from '@walnut-server/exceptions/base/406'
import { MurLockService } from 'murlock'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { SysDeviceRepositoryService } from '@/modules/system/device/repo/device.repo.service'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'

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
    private readonly murLockService: MurLockService,
  ) { }

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

    if (request.isPostman) {
      this.logger.debug('Postman runtime request, bypassed device check')
      return true
    }

    const cachedDevice = await this.cacheDeviceService.getSysDeviceCache(deviceId)

    if (!cachedDevice) {
      this.logger.warn(`Device not found in cache: ${deviceId}`)
      throw new WalnutAdminExceptionDeviceNotAcceptable()
    }

    if (cachedDevice.currentIp && request.realIp && cachedDevice.currentIp !== request.realIp) {
      this.logger.warn(`Device IP changed: ${deviceId}`)
      const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:DEVICE:IP_CHANGE:${deviceId}`
      await this.murLockService.runWithLock(
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

    if (cachedDevice.banned) {
      this.logger.warn(`Device banned: ${deviceId}`)
      throw new WalnutAdminExceptionDeviceBanned()
    }

    if (cachedDevice.locked) {
      this.logger.warn(`Device locked: ${deviceId}`)
      throw new WalnutAdminExceptionDeviceLocked()
    }

    this.logger.debug(`Device validated successfully: ${deviceId}`)
    return true
  }
}
