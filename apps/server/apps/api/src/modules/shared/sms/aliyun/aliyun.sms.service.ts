import Dypnsapi20170525, * as $Dypnsapi20170525 from '@alicloud/dypnsapi20170525'
import * as $OpenApi from '@alicloud/openapi-client'
import * as $Util from '@alicloud/tea-util'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

/**
 * Aliyun SMS Template Code Mapping
 * Personal developers can use free templates without enterprise qualification review
 * @see https://help.aliyun.com/zh/pnvs/user-guide/sms-authentication-service
 */
export const AliyunSmsTemplateCode = {
  /** Login/Register - Free template 100001 */
  SIGN_IN_OR_SIGN_UP: '100001',
  /** Update Phone - Free template 100002 */
  UPDATE_PHONE: '100002',
  /** Reset Password - Free template 100003 */
  RESET_PASSWORD: '100003',
  /** Bind New Phone - Free template 100004 */
  BIND_PHONE: '100004',
  /** Verify Phone - Free template 100005 */
  VERIFY_PHONE: '100005',
} as const

export type AliyunSmsTemplateCodeType = keyof typeof AliyunSmsTemplateCode

export interface AliyunSendSmsDto {
  phoneNumber: string
  templateCode: AliyunSmsTemplateCodeType
  signName?: string
  bizId?: string
  codeLength?: number
  codeType?: number
  validTime?: number
}

export interface AliyunVerifySmsDto {
  phoneNumber: string
  code: string
  bizId?: string
}

interface SendSmsModel {
  bizId?: string
  outId?: string
  verifyCode?: string
  requestId?: string
  code?: string
  success?: boolean
}

interface SendSmsResponseBody {
  code: string
  message?: string
  /** Aliyun returns model containing bizId (camelCase) */
  model?: SendSmsModel
}

interface VerifySmsModel {
  verifyResult?: string
  requestId?: string
  code?: string
  success?: boolean
}

interface VerifySmsResponseBody {
  code: string
  /** Aliyun returns model containing verifyResult (camelCase) */
  model?: VerifySmsModel
}

@Injectable()
export class AliyunSmsService {
  protected readonly logger = new Logger(AliyunSmsService.name)

  private readonly client: Dypnsapi20170525

  /** Aliyun SMS Endpoint */
  private readonly ALIYUN_SMS_ENDPOINT = 'dypnsapi.aliyuncs.com'

  /** Aliyun SMS Sign Name */
  private readonly ALIYUN_SMS_SIGN_NAME = '速通互联验证码'

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>('vendor.ali.OSS.id')
    const accessKeySecret = this.configService.get<string>('vendor.ali.OSS.secret')

    this.logger.log('Initializing Aliyun SMS service')
    this.logger.debug(`Aliyun SMS endpoint: ${this.ALIYUN_SMS_ENDPOINT}`)

    const config = new $OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: this.ALIYUN_SMS_ENDPOINT,
    })

    this.client = new Dypnsapi20170525(config)
    this.logger.log('Aliyun SMS service initialized successfully')
  }

  /**
   * Send SMS verification code
   * @param dto - SMS sending parameters
   * @returns Send result with BizId (PascalCase as returned by Aliyun)
   */
  async sendVerificationCode(dto: AliyunSendSmsDto): Promise<{
    success: boolean
    /** Aliyun returns bizId (camelCase) */
    BizId?: string
    expireTime?: number
  }> {
    const { phoneNumber, templateCode } = dto

    const templateCodeValue = AliyunSmsTemplateCode[templateCode]
    const signName = dto.signName ?? this.ALIYUN_SMS_SIGN_NAME
    const validTime = dto.validTime ?? 5
    const codeLength = dto.codeLength ?? 6
    const codeType = dto.codeType ?? 1
    const outId = dto.bizId ?? this.generateBizId()

    this.logger.log(`Preparing to send SMS verification code to: ${phoneNumber}`)
    this.logger.debug(`SMS params - templateCode: ${templateCodeValue}, signName: ${signName}, validTime: ${validTime}min, codeLength: ${codeLength}, codeType: ${codeType}, OutId: ${outId}`)

    const templateParam = JSON.stringify({
      code: '##code##',
      min: String(validTime),
    })
    this.logger.debug(`SMS templateParam: ${templateParam}`)

    const sendReq = new $Dypnsapi20170525.SendSmsVerifyCodeRequest({
      phoneNumber,
      signName,
      templateCode: templateCodeValue,
      templateParam,
      codeLength,
      codeType,
      outId,
    })

    try {
      this.logger.log(`Sending SMS request to Aliyun API for phone: ${phoneNumber}`)
      const runtime = new $Util.RuntimeOptions({})
      const response = await this.client.sendSmsVerifyCodeWithOptions(sendReq, runtime)

      const body = response.body as SendSmsResponseBody
      const responseCode = body.code

      this.logger.debug(`Aliyun SMS API response - code: ${responseCode}, message: ${body.message ?? 'N/A'}, BizId: ${body.model?.bizId ?? 'N/A'}`)

      if (responseCode !== 'OK') {
        this.logger.error(`Aliyun SMS API returned error - code: ${responseCode}, message: ${body.message ?? 'Unknown error'}`)
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
      }

      const resultBizId = body.model?.bizId
      const outId = body.model?.outId

      this.logger.log(`SMS sent successfully to ${phoneNumber}, BizId: ${resultBizId}, OutId: ${outId}`)

      return {
        success: true,
        BizId: resultBizId,
      }
    }
    catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`Failed to send SMS to ${phoneNumber}: ${err.message}`, err.stack)
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
    }
  }

  /**
   * Verify SMS verification code
   * @param dto - SMS verification parameters
   * @returns Verification result with VerifyResult (PascalCase as returned by Aliyun)
   */
  async verifyCode(dto: AliyunVerifySmsDto): Promise<{
    success: boolean
    /** Aliyun returns verifyResult (camelCase): PASS / FAIL / EXPIRED */
    VerifyResult?: string
  }> {
    const { phoneNumber, code, bizId } = dto

    this.logger.log(`Preparing to verify SMS code for phone: ${phoneNumber}`)
    this.logger.debug(`Verify params - phoneNumber: ${phoneNumber}, code: ${code.substring(0, 1)}****, OutId: ${bizId ?? 'N/A'}`)

    const verifyReq = new $Dypnsapi20170525.CheckSmsVerifyCodeRequest({
      phoneNumber,
      verifyCode: code,
      outId: bizId,
    })

    try {
      this.logger.log(`Sending verify request to Aliyun API for phone: ${phoneNumber}`)
      const runtime = new $Util.RuntimeOptions({})
      const response = await this.client.checkSmsVerifyCodeWithOptions(verifyReq, runtime)

      const body = response.body as VerifySmsResponseBody
      const responseCode = body.code
      const resultVerifyResult = body.model?.verifyResult

      this.logger.debug(`Aliyun verify API response - code: ${responseCode}, VerifyResult: ${resultVerifyResult ?? 'N/A'}`)

      if (responseCode !== 'OK') {
        this.logger.warn(`Aliyun verify API returned non-OK code: ${responseCode}`)
        return {
          success: false,
          VerifyResult: 'FAIL',
        }
      }

      // VerifyResult: PASS / FAIL / EXPIRED
      if (resultVerifyResult === 'PASS') {
        this.logger.log(`SMS code verification PASSED for phone: ${phoneNumber}`)
        return { success: true, VerifyResult: resultVerifyResult }
      }
      else {
        this.logger.warn(`SMS code verification FAILED for phone: ${phoneNumber}, VerifyResult: ${resultVerifyResult}`)
        return { success: false, VerifyResult: resultVerifyResult }
      }
    }
    catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`Failed to verify SMS code for ${phoneNumber}: ${err.message}`, err.stack)
      return { success: false, VerifyResult: 'FAIL' }
    }
  }

  /**
   * Generate business ID (idempotency)
   */
  private generateBizId(): string {
    const bizId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    this.logger.debug(`Generated OutId: ${bizId}`)
    return bizId
  }
}
