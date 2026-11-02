import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionRsaPubKeyNotFound } from '@walnut-server/exceptions/business/rsa'
import { isNil } from 'lodash'
import { AppTechCacheService } from '../cache.service'

@Injectable()
export class AppTechCacheRsaService {
  private readonly logger = new Logger(AppTechCacheRsaService.name)

  constructor(private readonly cacheService: AppTechCacheService) {}

  async setRsaPubKeyCache(deviceId: string, payload: string) {
    this.logger.debug(`set rsa pub key cache, deviceId: ${deviceId}, payload: ${payload}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 * 24 * 3600 })
  }

  async getRsaPubKeyCache(deviceId: string) {
    this.logger.debug(`get rsa pub key cache, deviceId: ${deviceId}`)
    // P0（2026-11）：这里**必须** await。AppTechCacheService.get 是 async —— 少了 await 时
    // `cached` 是 Promise，`isNil(Promise)` 恒 false ⇒ 下面的 40012 永不触发；而 async 函数会把
    // 这个 Promise 采纳成返回值，缓存缺失时调用方拿到 null。后果是两处调用方全部空转：
    // sign guard 的「握手已完成」守卫（guards/src/guards/sign.guard.ts:102）与
    // sign.service 的「should have rsa pubkey」（security/src/sign/sign.service.ts:36）。
    // 回归用例：cache.rsa.spec.ts「缓存缺失 ⇒ 抛 40012」—— 改回不 await 的写法该用例必红。
    const cached = await this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`)

    if (isNil(cached)) {
      throw new WalnutAdminExceptionRsaPubKeyNotFound()
    }

    return cached
  }
}
