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
    const cached = await this.findRsaPubKeyCache(deviceId)

    if (isNil(cached)) {
      throw new WalnutAdminExceptionRsaPubKeyNotFound()
    }

    return cached
  }

  /**
   * 探测式取值：**不抛** 40012，缺失返回 null。
   *
   * 为什么必须与 getRsaPubKeyCache 分开：握手端点 /security/sign/initial 的语义是
   * 「尚未登记 → 登记它」，缺失是**正常分支**而不是错误。补 await 之后（40012 从死码变成可达），
   * initial 若继续走抛错版就变成「登记公钥要求先有公钥」的鸡生蛋死锁：
   * 首次握手必然 40012，应用起不来（本机实测：api-spec 全线 40012、admin bootstrap 卡在 sign 步）。
   *
   * 需要「缺失即错误」的地方（响应加密、已签名请求的守卫校验）继续用 get 版。
   */
  async findRsaPubKeyCache(deviceId: string): Promise<string | null> {
    const cached = await this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`)
    return isNil(cached) ? null : cached
  }
}
