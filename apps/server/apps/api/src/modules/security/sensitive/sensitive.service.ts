import type { EntityManager } from 'typeorm'

import type {
  IWalnutAdminConstSecurityLevel,
  IWalnutAdminConstSecuritySensitiveType,
  IWalnutAdminConstVerifyMethod,
} from './sensitive.const'
import type { ISensitivePermissionData } from './sensitive.type'

import { Injectable } from '@nestjs/common'
import { AppTechRedisService } from '@walnut-server/cache'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { isNil } from 'lodash'
import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import { WalnutAdminConstSysUserIdentityPurpose } from '@/modules/system/user_identity/identity.const'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'

import { WalnutAdminConstVerifyMethod } from './sensitive.const'

@Injectable()
export class SecuritySensitiveService {
  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
    private readonly otpSharedService: OtpSharedService,
  ) {}

  private readonly EXPIRY_SECONDS = 15 * 60 // 15 minutes

  private get redis() {
    return this.redisService.getClient()
  }

  /**
   * Generate Redis key for user's security level permission (with deviceId)
   */
  private getRedisKey(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): string {
    return `sensitive_op:${userId}:${deviceId}:${level}`
  }

  /**
   * Grant permission for sensitive operation
   */
  async grantPermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
    operationType: IWalnutAdminConstSecuritySensitiveType,
    verifyMethod: IWalnutAdminConstVerifyMethod,
  ): Promise<void> {
    const key = this.getRedisKey(userId, deviceId, level)
    const now = AppDayjs().valueOf()

    const data: ISensitivePermissionData = {
      operationType,
      verifyMethod,
      grantedAt: now,
      expiresAt: now + this.EXPIRY_SECONDS * 1000,
    }

    await this.redis.setEx(
      key,
      this.EXPIRY_SECONDS,
      JSON.stringify(data),
    )
  }

  /**
   * Check if user has permission for security level
   */
  async hasPermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): Promise<boolean> {
    const key = this.getRedisKey(userId, deviceId, level)
    const exists = await this.redis.exists(key)
    return exists === 1
  }

  /**
   * Get permission data
   */
  async getPermissionData(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): Promise<ISensitivePermissionData | null> {
    const key = this.getRedisKey(userId, deviceId, level)
    const data = await this.redis.get(key)

    if (isNil(data)) {
      return null
    }

    try {
      return JSON.parse(data) as ISensitivePermissionData
    }
    catch {
      return null
    }
  }

  /**
   * Revoke permission for security level
   */
  async revokePermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): Promise<void> {
    const key = this.getRedisKey(userId, deviceId, level)
    await this.redis.del(key)
  }

  /**
   * Get remaining time in seconds
   */
  async getRemainingTime(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): Promise<number> {
    const key = this.getRedisKey(userId, deviceId, level)
    const ttl = await this.redis.ttl(key)
    return ttl > 0 ? ttl : 0
  }

  /**
   * Extend permission time
   */
  async extendPermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
  ): Promise<boolean> {
    const key = this.getRedisKey(userId, deviceId, level)
    const exists = await this.redis.exists(key)

    if (exists === 1) {
      await this.redis.expire(key, this.EXPIRY_SECONDS)
      return true
    }

    return false
  }

  /**
   * Get user's available verification methods based on security identity
   * Queries security purpose identities, not login purpose
   *
   * P1-5 修复（2026-10-28）：
   * - **摘除 password 通道** —— identity 的 value 是 opaque registration record，无法按
   *   明文口令比对还原（修复前该方式恒 verify 失败却仍出现在可用列表里）；
   * - 探测腿改容错：缺失某类 security 身份时**跳过该方式**（不用 getIdentityOrThrow），
   *   有其余可用方式即可正常进入 40119 验证流程，不会整条探测腿 40401。
   */
  async getUserAvailableMethods(
    userId: string,
    supportedMethods: IWalnutAdminConstVerifyMethod[],
  ): Promise<IWalnutAdminConstVerifyMethod[]> {
    const methods: IWalnutAdminConstVerifyMethod[] = []
    const securityPurpose = WalnutAdminConstSysUserIdentityPurpose.SECURITY

    // Check phone (security purpose)
    const phoneIdentity = await this.userIdentitySharedService.findIdentity(
      userId,
      'phoneNumber',
      securityPurpose,
      undefined,
    )
    if (phoneIdentity?.verified && phoneIdentity.status && supportedMethods.includes(WalnutAdminConstVerifyMethod.SMS)) {
      methods.push(WalnutAdminConstVerifyMethod.SMS)
    }

    // Check email (security purpose)
    const emailIdentity = await this.userIdentitySharedService.findIdentity(
      userId,
      'emailAddress',
      securityPurpose,
      undefined,
    )
    if (emailIdentity?.verified && emailIdentity.status && supportedMethods.includes(WalnutAdminConstVerifyMethod.EMAIL)) {
      methods.push(WalnutAdminConstVerifyMethod.EMAIL)
    }

    // TODO: Check MFA from MFA module
    // if (supportedMethods.includes(WalnutAdminConstVerifyMethod.MFA)) {
    //   const mfaEnabled = await this.mfaService.isEnabled(userId)
    //   if (mfaEnabled) {
    //     methods.push(WalnutAdminConstVerifyMethod.MFA)
    //   }
    // }

    return methods
  }

  /**
   * Perform verification based on method
   */
  async performVerification(
    userId: string,
    method: IWalnutAdminConstVerifyMethod,
    credential: string,
  ): Promise<boolean> {
    switch (method) {
      case WalnutAdminConstVerifyMethod.PASSWORD:
        return this.verifyPassword(userId, credential)

      case WalnutAdminConstVerifyMethod.SMS:
        return this.verifySmsCode(userId, credential)

      case WalnutAdminConstVerifyMethod.EMAIL:
        return this.verifyEmailCode(userId, credential)

      case WalnutAdminConstVerifyMethod.MFA:
        return this.verifyMfaCode(userId, credential)

      default:
        return false
    }
  }

  /**
   * Verify password
   *
   * P1-5：password 方式已从可用列表摘除（value 是 opaque record，无法明文比对）——
   * 分支保留以维持 switch 穷举形态，但恒返回 false（正常路径在
   * verifyAndGrantPermission 的 availableMethods 闸就已被 40000 拦下）。
   */
  private async verifyPassword(_userId: string, _password: string): Promise<boolean> {
    return false
  }

  /**
   * Verify SMS code
   */
  private async verifySmsCode(userId: string, code: string): Promise<boolean> {
    try {
      // Get phone identity (security purpose)
      const identifier = await this.userIdentitySharedService.getDecryptedIdentifier(
        userId,
        'phoneNumber',
        WalnutAdminConstSysUserIdentityPurpose.SECURITY,
        undefined,
      )

      // Verify code via OTP service
      return await this.otpSharedService.verifyCode('sms', identifier, code, userId)
    }
    catch {
      return false
    }
  }

  /**
   * Verify Email code
   */
  private async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    try {
      // Get email identity (security purpose)
      const identifier = await this.userIdentitySharedService.getDecryptedIdentifier(
        userId,
        'emailAddress',
        WalnutAdminConstSysUserIdentityPurpose.SECURITY,
        undefined,
      )

      // Verify code via OTP service
      return await this.otpSharedService.verifyCode('email', identifier, code, userId)
    }
    catch {
      return false
    }
  }

  /**
   * Verify MFA code
   */
  private async verifyMfaCode(_userId: string, _code: string): Promise<boolean> {
    // TODO: Implement MFA verification
    return false
  }

  /**
   * Check verification status for a security level
   */
  async checkVerificationStatus(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
    supportedMethods: IWalnutAdminConstVerifyMethod[],
  ): Promise<{
    needsVerification: boolean
    remainingSeconds?: number
    availableMethods?: IWalnutAdminConstVerifyMethod[]
    preferredMethod?: IWalnutAdminConstVerifyMethod
  }> {
    // Check if user already has permission
    const hasPermission = await this.hasPermission(userId, deviceId, level)

    if (hasPermission) {
      const remainingSeconds = await this.getRemainingTime(userId, deviceId, level)
      return {
        needsVerification: false,
        remainingSeconds,
      }
    }

    // Get user's available verification methods
    const availableMethods = await this.getUserAvailableMethods(userId, supportedMethods)

    if (availableMethods.length === 0) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.auth.noVerifyMethodAvailable',
      })
    }

    return {
      needsVerification: true,
      availableMethods,
      preferredMethod: availableMethods[0],
    }
  }

  /**
   * Verify user identity and grant permission
   *
   * B7c 迁移：事务句柄签名 `dbSession?: ClientSession` → `em?: EntityManager`。
   * 注意：上游 Mongo 版该形参即未接线（identity 读腿走缺省连接级 manager，`_` 前缀
   * 声明未使用）—— 缺陷原样迁移登记（phase3-plan §6 B7c），不在本批顺手接线。
   */
  async verifyAndGrantPermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
    operationType: IWalnutAdminConstSecuritySensitiveType,
    method: IWalnutAdminConstVerifyMethod,
    credential: string,
    supportedMethods: IWalnutAdminConstVerifyMethod[],
    _em?: EntityManager,
  ): Promise<void> {
    // Check if method is allowed
    const availableMethods = await this.getUserAvailableMethods(userId, supportedMethods)

    if (!availableMethods.includes(method)) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.auth.verifyMethodNotAllowed',
      })
    }

    // Perform verification
    const isValid = await this.performVerification(userId, method, credential)

    if (!isValid) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.auth.verificationFailed',
      })
    }

    // Grant permission (Redis operation, no need for MongoDB session)
    await this.grantPermission(userId, deviceId, level, operationType, method)
  }
}
