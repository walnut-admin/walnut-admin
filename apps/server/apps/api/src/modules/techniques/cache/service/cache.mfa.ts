import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { IWalnutAdminConstSysUserMfaType } from '@/modules/system/user_mfa/schema/user_mfa.schema'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

type WalnutAdminConstSysUserMfaWebauthnType = 'registration' | 'authentication'

@Injectable()
export class AppTechCacheMfaService {
  private readonly logger = new Logger(AppTechCacheMfaService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly tokenService: AppTokenService,
  ) { }

  private readonly getVerifiedCacheKey = (userId: string, deviceId: string) => `${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${userId}:${deviceId}`

  /**
   * @description set user MFA verified cache
   */
  async setVerifiedCache(userId: string, deviceId: string) {
    const cacheKey = this.getVerifiedCacheKey(userId, deviceId)
    const ttl = this.tokenService.getRefreshTokenExpireSeconds()
    await this.cacheService.set(cacheKey, true, { t: WalnutAdminConstAppCacheType.AUTH, ttl })
    this.logger.debug(`Set MFA verified cache: key => ${cacheKey}`)
  }

  /**
   * @description delete user MFA verified cache
   */
  async delVerifiedCache(userId: string, deviceId: string) {
    const cacheKey = this.getVerifiedCacheKey(userId, deviceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete MFA verified cache: key => ${cacheKey}`)
  }

  /**
   * @description get user MFA verified cache
   */
  async getVerifiedCache(userId: string, deviceId: string) {
    const cacheKey = this.getVerifiedCacheKey(userId, deviceId)
    this.logger.debug(`Get MFA verified cache: key => ${cacheKey}`)
    return this.cacheService.get<IWalnutAdminConstSysUserMfaType[]>(cacheKey)
  }

  /**
   * @description touch user MFA verified cache TTL
   */
  async touchVerifiedCache(userId: string, deviceId: string) {
    const cacheKey = this.getVerifiedCacheKey(userId, deviceId)
    const ttl = this.tokenService.getRefreshTokenExpireSeconds()
    await this.cacheService.expire(cacheKey, ttl)
    this.logger.debug(`Touch MFA verified cache TTL: key => ${cacheKey}, ttl=${ttl}`)
  }

  private readonly getTotpCacheKey = (userId: string, deviceId: string) => `${WalnutAdminConstAppCacheKeys.AUTH_MFA_TOTP}:${userId}:${deviceId}`

  /**
   * @description set user TOTP verified cache
   */
  async setTotpCache(userId: string, deviceId: string, payload: string) {
    const cacheKey = this.getTotpCacheKey(userId, deviceId)
    await this.cacheService.set(cacheKey, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 })
    this.logger.debug(`Set TOTP verified cache: key => ${cacheKey}`)
  }

  /**
   * @description delete user TOTP verified cache
   */
  async delTotpCache(userId: string, deviceId: string) {
    const cacheKey = this.getTotpCacheKey(userId, deviceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete TOTP verified cache: key => ${cacheKey}`)
  }

  /**
   * @description get user TOTP verified cache
   */
  async getTotpCache(userId: string, deviceId: string) {
    const cacheKey = this.getTotpCacheKey(userId, deviceId)
    this.logger.debug(`Get TOTP verified cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }

  private readonly getWebauthnCacheKey = (userId: string, deviceId: string, type: WalnutAdminConstSysUserMfaWebauthnType) => `${WalnutAdminConstAppCacheKeys.AUTH_MFA_WEBAUTN}:${userId}:${deviceId}:${type}`

  /**
   * @description set user WebAuthn verified cache
   */
  async setWebauthnCache(userId: string, deviceId: string, type: WalnutAdminConstSysUserMfaWebauthnType, payload: string) {
    const cacheKey = this.getWebauthnCacheKey(userId, deviceId, type)
    await this.cacheService.set(cacheKey, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 })
    this.logger.debug(`Set WebAuthn ${type} verified cache: key => ${cacheKey}`)
  }

  /**
   * @description delete user WebAuthn verified cache
   */
  async delWebauthnCache(userId: string, deviceId: string, type: WalnutAdminConstSysUserMfaWebauthnType) {
    const cacheKey = this.getWebauthnCacheKey(userId, deviceId, type)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete WebAuthn ${type} verified cache: key => ${cacheKey}`)
  }

  /**
   * @description get user WebAuthn verified cache
   */
  async getWebauthnCache(userId: string, deviceId: string, type: WalnutAdminConstSysUserMfaWebauthnType) {
    const cacheKey = this.getWebauthnCacheKey(userId, deviceId, type)
    this.logger.debug(`Get WebAuthn ${type} verified cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }
}
