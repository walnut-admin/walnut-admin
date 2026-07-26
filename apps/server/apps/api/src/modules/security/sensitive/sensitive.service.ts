import type { ClientSession } from 'mongoose'

import type {
  IWalnutAdminConstSecurityLevel,
  IWalnutAdminConstSecuritySensitiveType,
  IWalnutAdminConstVerifyMethod,
} from './sensitive.const'
import type { ISensitivePermissionData } from './sensitive.type'

import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { AppDayjs } from '@walnut-server/utils/dayjs'
import { isNil } from 'lodash'
import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import { WalnutAdminConstSysUserIdentityPurpose } from '@/modules/system/user_identity/schema/user_identity.schema'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'

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
   */
  async getUserAvailableMethods(
    userId: string,
    supportedMethods: IWalnutAdminConstVerifyMethod[],
  ): Promise<IWalnutAdminConstVerifyMethod[]> {
    const methods: IWalnutAdminConstVerifyMethod[] = []
    const securityPurpose = WalnutAdminConstSysUserIdentityPurpose.SECURITY

    // Check password (login purpose for password, as there's no security password)
    const passwordIdentity = await this.userIdentitySharedService.getIdentityOrThrow(
      userId,
      'password',
      'login',
      undefined,
    )
    if (passwordIdentity.status && supportedMethods.includes(WalnutAdminConstVerifyMethod.PASSWORD)) {
      methods.push(WalnutAdminConstVerifyMethod.PASSWORD)
    }

    // Check phone (security purpose)
    const phoneIdentity = await this.userIdentitySharedService.getIdentityOrThrow(
      userId,
      'phoneNumber',
      securityPurpose,
      undefined,
    )
    if (phoneIdentity.verified && phoneIdentity.status && supportedMethods.includes(WalnutAdminConstVerifyMethod.SMS)) {
      methods.push(WalnutAdminConstVerifyMethod.SMS)
    }

    // Check email (security purpose)
    const emailIdentity = await this.userIdentitySharedService.getIdentityOrThrow(
      userId,
      'emailAddress',
      securityPurpose,
      undefined,
    )
    if (emailIdentity.verified && emailIdentity.status && supportedMethods.includes(WalnutAdminConstVerifyMethod.EMAIL)) {
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
   */
  private async verifyPassword(userId: string, password: string): Promise<boolean> {
    try {
      // Get password identity
      const passwordIdentity = await this.userIdentitySharedService.getIdentityOrThrow(
        userId,
        'password',
        'login',
        undefined,
      )

      // Decrypt stored password
      const decryptedPassword = this.userIdentitySharedService.decryptValue(passwordIdentity.value)

      // Compare passwords
      return decryptedPassword === password
    }
    catch {
      return false
    }
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
   */
  async verifyAndGrantPermission(
    userId: string,
    deviceId: string,
    level: IWalnutAdminConstSecurityLevel,
    operationType: IWalnutAdminConstSecuritySensitiveType,
    method: IWalnutAdminConstVerifyMethod,
    credential: string,
    supportedMethods: IWalnutAdminConstVerifyMethod[],
    _dbSession?: ClientSession,
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
