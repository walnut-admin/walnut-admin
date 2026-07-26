import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { AppTechCacheService } from '../cache.service'

@Injectable()
export class AppTechCacheVerifyCodeService {
  private readonly logger = new Logger(AppTechCacheVerifyCodeService.name)

  constructor(private readonly cacheService: AppTechCacheService) {}

  async setVerifyCodeForAuthUserCache(userId: string, identifier: string, verifyCode: number, ttl: number) {
    this.logger.debug(`set verify code for auth user cache, userId: ${userId}, identifier: ${identifier}, verifyCode: ${verifyCode}, ttl: ${ttl}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:${userId}:${identifier}`, verifyCode, { t: WalnutAdminConstAppCacheType.AUTH, ttl })
  }

  async getVerifyCodeForAuthUserCache(userId: string, identifier: string) {
    this.logger.debug(`get verify code for auth user cache, userId: ${userId}, identifier: ${identifier}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:${userId}:${identifier}`)
  }

  async delVerifyCodeForAuthUserCache(userId: string, identifier: string) {
    this.logger.debug(`del verify code for auth user cache, userId: ${userId}, identifier: ${identifier}`)
    await this.cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:${userId}:${identifier}`)
  }

  async setVerifyCodeForVisitorCache(identifier: string, verifyCode: number, ttl: number) {
    this.logger.debug(`set verify code for visitor cache, identifier: ${identifier}, verifyCode: ${verifyCode}, ttl: ${ttl}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:visitor:${identifier}`, verifyCode, { t: WalnutAdminConstAppCacheType.AUTH, ttl })
  }

  async getVerifyCodeForVisitorCache(identifier: string) {
    this.logger.debug(`get verify code for visitor cache, identifier: ${identifier}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:visitor:${identifier}`)
  }

  async delVerifyCodeForVisitorCache(identifier: string) {
    this.logger.debug(`del verify code for visitor cache, identifier: ${identifier}`)
    await this.cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:visitor:${identifier}`)
  }

  // Aliyun SMS BizId cache methods
  async setAliyunSmsBizIdForVisitorCache(identifier: string, bizId: string, ttl: number) {
    this.logger.debug(`set aliyun sms bizId for visitor cache, identifier: ${identifier}, bizId: ${bizId}, ttl: ${ttl}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:aliyun:bizId:visitor:${identifier}`, bizId, { t: WalnutAdminConstAppCacheType.AUTH, ttl })
  }

  async getAliyunSmsBizIdForVisitorCache(identifier: string) {
    this.logger.debug(`get aliyun sms bizId for visitor cache, identifier: ${identifier}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:aliyun:bizId:visitor:${identifier}`)
  }

  async delAliyunSmsBizIdForVisitorCache(identifier: string) {
    this.logger.debug(`del aliyun sms bizId for visitor cache, identifier: ${identifier}`)
    await this.cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE}:aliyun:bizId:visitor:${identifier}`)
  }
}
