/**
 * @deprecated 腾讯云短信服�?- 已弃�?
 * 该文件仅作为代码留存，不再被任何模块引入
 * 阿里云短信服务已取代腾讯云短信服�?
 */

import type { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import type { Client } from 'tencentcloud-sdk-nodejs/tencentcloud/services/sms/v20210111/sms_client'
import type { SendSmsRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/sms/v20210111/sms_models'

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import * as tencentcloud from 'tencentcloud-sdk-nodejs'

export interface TencentSendSmsDto {
  phoneNumber: string
  verifyCode: string
  expireSeconds: number
}

@Injectable()
export class TencentSmsService {
  protected readonly logger = new Logger(TencentSmsService.name)

  private readonly smsClient: Client

  constructor(private readonly configService: ConfigService) {
    const clientConfig: ClientConfig = {
      credential: {
        secretId: configService.get('vendor.tx.SMS.id'),
        secretKey: configService.get('vendor.tx.SMS.secret'),
      },
      region: configService.get('vendor.tx.SMS.region'),
      profile: {
        signMethod: 'HmacSHA256',
        httpProfile: {
          endpoint: configService.get('vendor.tx.SMS.endPoint'),
          reqMethod: 'POST',
          reqTimeout: 60,
        },
      },
    }

    this.smsClient = new tencentcloud.sms.v20210111.Client(clientConfig)
  }

  /**
   * 发送短信验证码
   */
  async sendVerificationCode(dto: TencentSendSmsDto): Promise<{ success: boolean }> {
    const { phoneNumber, verifyCode, expireSeconds } = dto

    const params: SendSmsRequest = {
      SmsSdkAppId: this.configService.get('vendor.tx.SMS.sdkAppId') as string,
      SignName: this.configService.get('vendor.tx.SMS.signName'),
      TemplateId: this.configService.get('vendor.tx.SMS.templateId') as string,
      TemplateParamSet: [`${verifyCode}`, `${Math.floor(expireSeconds / 60)}`],
      PhoneNumberSet: [phoneNumber],
      SessionContext: '',
      ExtendCode: '',
      SenderId: '',
    }

    try {
      const res = await this.smsClient.SendSms(params)
      this.logger.log(res)

      if (res.SendStatusSet && res.SendStatusSet[0].Code === 'Ok') {
        return { success: true }
      }
      else {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
      }
    }
    catch {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
    }
  }
}
