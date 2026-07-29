import type { LocaleType } from '@walnut/contract'

import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { ClientSession } from 'mongoose'
import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import {
  SysUserIdentityBindRequestDTO,
  SysUserIdentityCheckRequestDTO,
  SysUserIdentityListDTO,
  SysUserIdentityStatusRequestDTO,
  SysUserIdentityUpdateDTO,
  SysUserIdentityVerifyRequestDTO,
} from './dto/user_identity.dto'
import { SysUserIdentityRepositoryService } from './repo/user_identity.repo.service'
import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
  WalnutAdminConstSysUserIdentityPurpose,
} from './schema/user_identity.schema'
import { SysUserIdentitySharedService } from './shared/user_identity.shared.service'
import { SysUserIdentityBasicRepository } from './user_identity.basic.repository'

@Injectable()
export class SysUserIdentityService {
  constructor(
    private readonly identityBasicRepo: SysUserIdentityBasicRepository,
    private readonly identitySharedService: SysUserIdentitySharedService,
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly otpSharedService: OtpSharedService,
  ) {}

  // List identities for a user
  async list(dto: SysUserIdentityListDTO & { userId: string }, dbSession?: ClientSession) {
    const { userId } = dto
    const identities = await this.userIdentityRepoService.findByUserId(userId, dbSession)

    return {
      data: identities,
      total: identities.length,
    }
  }

  // Get user identity status (like Figure 1)
  async getStatus(userId: string, purpose: IWalnutAdminConstSysUserIdentityPurpose, dbSession: ClientSession) {
    return this.identitySharedService.getUserIdentityStatus(userId, purpose, dbSession)
  }

  /**
   * Pre-bind check: validate uniqueness and send verification code
   * Step 1 of binding process
   */
  async check(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityCheckRequestDTO,
    language: LocaleType,
  ) {
    const { identifier } = dto

    // Check 1: Already bound by current user
    await this.identitySharedService.assertIdentityNotExists(userId, type, purpose)

    // Check 2: Value already used by another user
    await this.identitySharedService.assertValueNotExists(type, purpose, identifier)

    // All checks passed - send verification code
    const otpType = this.identitySharedService.getOtpType(type)
    await this.otpSharedService.sendVerifyCode(otpType, identifier, language, userId)
  }

  // Bind identity (step 2: verify code and create)
  async bind(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityBindRequestDTO,
    dbSession?: ClientSession,
  ) {
    const { identifier, verifyCode, setAsSecurity } = dto

    // Step 1: Verify the verification code
    await this.identitySharedService.verifyOtpCode(type, identifier, verifyCode, userId)

    // Step 2: Check if already exists
    await this.identitySharedService.assertIdentityNotExists(userId, type, purpose, dbSession)

    // Step 3: Check if value is already used by another user
    await this.identitySharedService.assertValueNotExists(type, purpose, identifier, dbSession)

    // Step 4: Prepare identity value
    const identityValue = this.identitySharedService.prepareIdentityValue(type, identifier)

    // Step 5: Create identity
    const result = await this.userIdentityRepoService.createIdentity({
      userId,
      type,
      purpose,
      ...identityValue,
      verified: true,
      verifiedAt: new Date(),
      metadata: {},
    }, dbSession)

    // Step 6: Handle security identity if needed
    if (setAsSecurity && purpose === 'login') {
      await this.handleSecurityIdentity(userId, type, identityValue, dbSession)
    }

    return result
  }

  // Helper: Create or update security identity
  private async handleSecurityIdentity(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    identityValue: { value: string, valueHash: string, maskedValue: string },
    dbSession?: ClientSession,
  ) {
    const existingSecurity = await this.userIdentityRepoService.findByUserIdTypeAndPurpose(
      userId,
      type,
      WalnutAdminConstSysUserIdentityPurpose.SECURITY,
      dbSession,
    )

    const securityPayload = {
      ...identityValue,
      verified: true,
      verifiedAt: new Date(),
    }

    if (existingSecurity) {
      await this.userIdentityRepoService.updateByUserIdTypeAndPurpose(
        userId,
        type,
        WalnutAdminConstSysUserIdentityPurpose.SECURITY,
        securityPayload,
        dbSession,
      )
    }
    else {
      await this.userIdentityRepoService.createIdentity({
        userId,
        type,
        purpose: WalnutAdminConstSysUserIdentityPurpose.SECURITY,
        ...securityPayload,
        metadata: {},
      }, dbSession)
    }
  }

  // Unbind identity
  async unbind(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, dbSession)

    // Cannot unbind if it's the only verified login method
    if (type !== 'password' && purpose === 'login') {
      await this.assertCanUnbind(userId, type, dbSession)
    }

    return this.identityBasicRepo.deleteRealById(existing._id.toString(), dbSession)
  }

  // Helper: Check if user has other verified login methods
  private async assertCanUnbind(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    dbSession?: ClientSession,
  ) {
    const allIdentities = await this.userIdentityRepoService.findByUserId(userId, dbSession)

    // Count other verified and active login methods (excluding current one)
    const otherVerifiedLoginMethods = allIdentities.filter(
      i => i.type !== type
        && i.purpose === 'login'
        && i.verified
        && i.status,
    )

    // Also check if user has password set
    const hasPassword = allIdentities.some(i => i.type === 'password' && i.status)

    // If no other verified login methods and no password, deny unbind
    if (otherVerifiedLoginMethods.length === 0 && !hasPassword) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.unbindAtLeastOneLoginMethodRequired' })
    }
  }

  // Update identity (rebind)
  // Note: Old identity ownership is verified by SensitiveOperationGuard + short-term token
  async update(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityUpdateDTO,
    dbSession?: ClientSession,
  ) {
    const { value, verified, status } = dto

    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, dbSession)

    const updatePayload: Record<string, unknown> = {}

    if (value !== undefined) {
      // Check if new value is already used by another user
      await this.identitySharedService.assertValueNotExists(type, purpose, value, dbSession)

      // Prepare new identity value
      const identityValue = this.identitySharedService.prepareIdentityValue(type, value)
      Object.assign(updatePayload, identityValue)

      // Reset verified to false when changing value - requires re-verification
      updatePayload.verified = false
      updatePayload.verifiedAt = null
    }

    if (verified !== undefined) {
      // Can only set verified through verify() endpoint with code verification
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.useVerifyEndpoint' })
    }

    if (status !== undefined) {
      updatePayload.status = status
    }

    return this.identityBasicRepo.updateByField(
      { _id: existing._id },
      updatePayload,
      dbSession,
    )
  }

  // Update identity status (enable/disable)
  async updateStatus(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityStatusRequestDTO,
    dbSession?: ClientSession,
  ) {
    const { status } = dto
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, dbSession)

    return this.identityBasicRepo.updateByField(
      { _id: existing._id },
      { status },
      dbSession,
    )
  }

  // Send verification code to existing unverified identity
  async sendCode(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    language: LocaleType,
  ) {
    // Get decrypted identifier from DB
    const identifier = await this.identitySharedService.getDecryptedIdentifier(userId, type, purpose)

    // Send verification code
    const otpType = this.identitySharedService.getOtpType(type)
    await this.otpSharedService.sendVerifyCode(otpType, identifier, language, userId)
  }

  // Verify identity (verify code and mark as verified)
  async verify(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityVerifyRequestDTO,
    dbSession?: ClientSession,
  ) {
    const { verifyCode } = dto

    // Step 1: Get identity and decrypt identifier
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, dbSession)
    const identifier = await this.identitySharedService.getDecryptedIdentifier(userId, type, purpose, dbSession)

    // Step 2: Verify the verification code
    await this.identitySharedService.verifyOtpCode(type, identifier, verifyCode, userId)

    // Step 3: Mark as verified
    return this.identityBasicRepo.updateByField(
      { _id: existing._id },
      { verified: true, verifiedAt: new Date() },
      dbSession,
    )
  }
}
