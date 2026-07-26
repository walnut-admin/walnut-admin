import type { IOtpType } from './const/otp.const'
// Note: IWalnutAdminOtpThrottleConfigProvider has been moved to global IWalnutAdminOtpThrottleConfigProvider
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class OtpSettingService {
  private readonly logger = new Logger(OtpSettingService.name)

  constructor(private readonly cacheAppSettingsService: AppTechCacheAppSettingsService) {}

  /**
   * Get throttle limit based on OTP type
   */
  async getThrottleLimit(type: IOtpType): Promise<number> {
    const config = await this.getConfig(type)
    const value = +config.sendLimit
    this.logger.log(`${type} send limit: ${value}`)
    return value
  }

  /**
   * Get throttle TTL based on OTP type
   */
  async getThrottleTtl(type: IOtpType): Promise<number> {
    const config = await this.getConfig(type)
    const value = +config.sendTtl
    this.logger.log(`${type} send TTL: ${value}`)
    return value
  }

  /**
   * Get verification code figure (length) based on OTP type
   */
  async getVerifyFigure(type: IOtpType): Promise<number> {
    const config = await this.getConfig(type)
    const value = +config.verifyFigure
    this.logger.log(`${type} verify figure: ${value}`)
    return value
  }

  /**
   * Get verification code TTL based on OTP type
   */
  async getVerifyTtl(type: IOtpType): Promise<number> {
    const config = await this.getConfig(type)
    const value = +config.verifyTtl
    this.logger.log(`${type} verify TTL: ${value}`)
    return value
  }

  /**
   * Get new user signup enabled based on OTP type
   */
  async getNewUserSignup(type: IOtpType): Promise<boolean> {
    const config = await this.getConfig(type)
    const value = !!config.newUserSignup
    this.logger.log(`${type} new user signup: ${value}`)
    return value
  }

  /**
   * Get auth enabled based on OTP type
   */
  async getAuthEnabled(type: IOtpType): Promise<boolean> {
    const config = await this.getConfig(type)
    const value = !!config.authEnable
    this.logger.log(`${type} auth enabled: ${value}`)
    return value
  }

  /**
   * Get send enabled based on OTP type
   */
  async getSendEnabled(type: IOtpType): Promise<boolean> {
    const config = await this.getConfig(type)
    const value = !!config.sendEnable
    this.logger.log(`${type} send enabled: ${value}`)
    return value
  }

  /**
   * Private method to get config based on type
   */
  private async getConfig(type: IOtpType) {
    if (type === 'email') {
      return this.cacheAppSettingsService.getAuthEmailConfig()
    }
    else {
      return this.cacheAppSettingsService.getAuthSmsConfig()
    }
  }
}
