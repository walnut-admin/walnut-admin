import type { IIdentityOtpService } from '@walnut-server/identity'
import type { LocaleType } from '@walnut/contract'

import type { IOtpType } from '../const/otp.const'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheVerifyCodeService } from '@walnut-server/cache'
import { AppMailerService } from '@walnut-server/mailer'
import { AliyunSmsService, AppSmsService } from '@walnut-server/sms'
import { generateVerifyCode } from '@walnut-server/utils/general'
import { isNil } from 'lodash'
import { OtpSettingService } from '../otp.setting.service'

@Injectable()
/** 批 6：implements 是端口绑定的编译期守护（libs/identity 只认端口）。 */
export class OtpSharedService implements IIdentityOtpService {
  private readonly logger = new Logger(OtpSharedService.name)

  constructor(
    private readonly mailerService: AppMailerService,
    private readonly smsService: AppSmsService,
    private readonly settingService: OtpSettingService,
    private readonly cacheVerifyCodeService: AppTechCacheVerifyCodeService,
    private readonly aliyunSmsService: AliyunSmsService,
  ) {}

  /**
   * Send OTP verification code via email or SMS
   */
  async sendVerifyCode(
    type: IOtpType,
    identifier: string,
    language: LocaleType,
    userId?: string,
  ): Promise<boolean> {
    this.logger.log(`Sending ${type} verify code to: ${identifier}`)

    // Get settings
    const codeFigure = await this.settingService.getVerifyFigure(type)
    const codeTTL = await this.settingService.getVerifyTtl(type)

    // Generate verify code
    const code = generateVerifyCode(codeFigure)

    // Send based on type
    if (type === 'email') {
      // WARNING: DO NOT USE AWAIT HERE, IT WILL BLOCK THE RESPONSE
      void this.mailerService.sendVerifyCodeEmail(identifier, code, codeTTL, language)
    }
    else {
      // WARNING: DO NOT USE AWAIT HERE, IT WILL BLOCK THE RESPONSE
      void this.smsService.sendVerifyCodeTextMessage(identifier, code, codeTTL, language)
    }

    // Cache the verify code
    if (!isNil(userId)) {
      await this.cacheVerifyCodeService.setVerifyCodeForAuthUserCache(userId, identifier, code, codeTTL)
    }
    else {
      await this.cacheVerifyCodeService.setVerifyCodeForVisitorCache(identifier, code, codeTTL)
    }

    return true
  }

  /**
   * Verify OTP code
   * If using Aliyun SMS, will call Aliyun API to verify
   * Otherwise use local cache verification
   */
  async verifyCode(
    type: IOtpType,
    identifier: string,
    code: string,
    userId?: string,
  ): Promise<boolean> {
    this.logger.log(`Verifying ${type} code for: ${identifier}`)

    if (type === 'sms') {
      this.logger.log('Using Aliyun SMS verification')

      // Get bizId from cache for precise verification
      const bizId = await this.cacheVerifyCodeService.getAliyunSmsBizIdForVisitorCache(identifier)
      this.logger.debug(`Retrieved bizId from cache for ${identifier}: ${bizId ?? 'N/A'}`)

      // Use Aliyun API to verify SMS code
      const result = await this.aliyunSmsService.verifyCode({
        phoneNumber: identifier,
        code,
        bizId: bizId ?? undefined,
      })

      // Clean up bizId cache after verification attempt
      await this.cacheVerifyCodeService.delAliyunSmsBizIdForVisitorCache(identifier)

      return result.success && result.VerifyResult === 'PASS'
    }

    // Use local cache verification (email or SMS without Aliyun API verify)
    let codeFromCache: string | null

    if (!isNil(userId)) {
      codeFromCache = await this.cacheVerifyCodeService.getVerifyCodeForAuthUserCache(userId, identifier)
    }
    else {
      codeFromCache = await this.cacheVerifyCodeService.getVerifyCodeForVisitorCache(identifier)
    }

    if (isNil(codeFromCache)) {
      return false
    }

    return +codeFromCache === +code
  }

  /**
   * Remove cached verify code
   */
  async removeVerifyCode(identifier: string): Promise<void> {
    await this.cacheVerifyCodeService.delVerifyCodeForVisitorCache(identifier)
  }
}
