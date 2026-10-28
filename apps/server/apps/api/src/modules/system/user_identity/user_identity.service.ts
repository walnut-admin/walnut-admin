import type { LocaleType } from '@walnut/contract'
import type { EntityManager } from 'typeorm'

import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import {
  SysUserIdentityBindRequestDTO,
  SysUserIdentityCheckRequestDTO,
  SysUserIdentityListDTO,
  SysUserIdentityStatusRequestDTO,
  SysUserIdentityUpdateDTO,
  SysUserIdentityVerifyRequestDTO,
} from './dto/user_identity.dto'
import { SysUserIdentityEntity } from './entity/user-identity.entity'
import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
  WalnutAdminConstSysUserIdentityPurpose,
} from './identity.const'
import { SysUserIdentityRepositoryService } from './repo/user_identity.repo.service'
import { SysUserIdentitySharedService } from './shared/user_identity.shared.service'
import { SysUserIdentityBasicRepository } from './user_identity.basic.repository'

/**
 * B7a 迁移：事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（纯透传，
 * B1 模板）；`existing._id.toString()` → `existing.id`（PG 实体即 POJO）。
 */
@Injectable()
export class SysUserIdentityService {
  constructor(
    private readonly identityBasicRepo: SysUserIdentityBasicRepository,
    private readonly identitySharedService: SysUserIdentitySharedService,
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly otpSharedService: OtpSharedService,
  ) {}

  // List identities for a user
  async list(dto: SysUserIdentityListDTO & { userId: string }, em?: EntityManager) {
    const { userId } = dto
    const identities = await this.userIdentityRepoService.findByUserId(userId, em)

    return {
      data: identities,
      total: identities.length,
    }
  }

  // Get user identity status (like Figure 1)
  async getStatus(userId: string, purpose: IWalnutAdminConstSysUserIdentityPurpose, em?: EntityManager) {
    return this.identitySharedService.getUserIdentityStatus(userId, purpose, em)
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
    em?: EntityManager,
  ) {
    const { identifier, verifyCode, setAsSecurity } = dto

    // Step 1: Verify the verification code
    await this.identitySharedService.verifyOtpCode(type, identifier, verifyCode, userId)

    // Step 2: Check if already exists
    await this.identitySharedService.assertIdentityNotExists(userId, type, purpose, em)

    // Step 3: Check if value is already used by another user
    await this.identitySharedService.assertValueNotExists(type, purpose, identifier, em)

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
    }, em)

    // Step 6: Handle security identity if needed
    if (setAsSecurity && purpose === 'login') {
      await this.handleSecurityIdentity(userId, type, identityValue, em)
    }

    return result
  }

  // Helper: Create or update security identity
  private async handleSecurityIdentity(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    identityValue: { value: string, valueHash: string, maskedValue: string },
    em?: EntityManager,
  ) {
    const existingSecurity = await this.userIdentityRepoService.findByUserIdTypeAndPurpose(
      userId,
      type,
      WalnutAdminConstSysUserIdentityPurpose.SECURITY,
      em,
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
        em,
      )
    }
    else {
      await this.userIdentityRepoService.createIdentity({
        userId,
        type,
        purpose: WalnutAdminConstSysUserIdentityPurpose.SECURITY,
        ...securityPayload,
        metadata: {},
      }, em)
    }
  }

  // Unbind identity
  async unbind(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    em?: EntityManager,
  ) {
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, em)

    // Cannot unbind if it's the only verified login method
    if (type !== 'password' && purpose === 'login') {
      await this.assertCanUnbind(userId, type, em)
    }

    return this.identityBasicRepo.deleteRealById(existing.id, em)
  }

  // Helper: Check if user has other verified login methods
  private async assertCanUnbind(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    em?: EntityManager,
  ) {
    const allIdentities = await this.userIdentityRepoService.findByUserId(userId, em)

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
    em?: EntityManager,
  ) {
    const { value, verified, status } = dto

    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, em)

    const updatePayload: Partial<SysUserIdentityEntity> = {}

    // P1-6③ 修复（2026-10-28）：判据从 `!== undefined` 改 `!= null` —— partial DTO 经
    // 全局 ValidationPipe 深度实例化后，未给键以**显式 null** 落实例；旧判据把 null 当
    // 「给了值」→ verified 分支恒命中 useVerifyEndpoint，任何 body 都到不了改值逻辑。
    if (value != null) {
      // Check if new value is already used by another user
      await this.identitySharedService.assertValueNotExists(type, purpose, value, em)

      // Prepare new identity value
      const identityValue = this.identitySharedService.prepareIdentityValue(type, value)
      Object.assign(updatePayload, identityValue)

      // Reset verified to false when changing value - requires re-verification
      updatePayload.verified = false
      updatePayload.verifiedAt = null
    }

    if (verified != null) {
      // Can only set verified through verify() endpoint with code verification
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.useVerifyEndpoint' })
    }

    if (status != null) {
      updatePayload.status = status
    }

    return this.identityBasicRepo.updateByField(
      { id: existing.id },
      updatePayload,
      em,
    )
  }

  // Update identity status (enable/disable)
  async updateStatus(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dto: SysUserIdentityStatusRequestDTO,
    em?: EntityManager,
  ) {
    const { status } = dto
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, em)

    return this.identityBasicRepo.updateByField(
      { id: existing.id },
      { status },
      em,
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
    em?: EntityManager,
  ) {
    const { verifyCode } = dto

    // Step 1: Get identity and decrypt identifier
    const existing = await this.identitySharedService.getIdentityOrThrow(userId, type, purpose, em)
    const identifier = await this.identitySharedService.getDecryptedIdentifier(userId, type, purpose, em)

    // Step 2: Verify the verification code
    await this.identitySharedService.verifyOtpCode(type, identifier, verifyCode, userId)

    // Step 3: Mark as verified
    return this.identityBasicRepo.updateByField(
      { id: existing.id },
      { verified: true, verifiedAt: new Date() },
      em,
    )
  }
}
