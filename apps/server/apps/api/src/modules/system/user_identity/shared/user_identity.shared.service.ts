import type { IOtpType } from '@/modules/auth/modules/otp/const/otp.const'

import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut/exceptions/base/404'

import { isNil } from 'lodash'
import { ClientSession } from 'mongoose'
import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import { SharedMaskService } from '@/modules/shared/mask/mask.service'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'

import { SysUserIdentityStatusResponseDTO } from '../dto/user_identity.dto'
import { SysUserIdentityRepositoryService } from '../repo/user_identity.repo.service'
import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
} from '../schema/user_identity.schema'

@Injectable()
export class SysUserIdentitySharedService {
  private readonly logger = new Logger(SysUserIdentitySharedService.name)

  private readonly IDENTITY_ENCRYPTION_KEY = 'crypto.userIdentityKey'
  private readonly IDENTITY_HASH_SALT = 'crypto.userIdentitySalt'
  private readonly ENC_ADD = 'sys_user_identity' // 用于加密时的附加认证数据，确保同一加密密钥在不同场景下的加密结果不同，防止跨场景重放攻?

  constructor(
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly otpSharedService: OtpSharedService,
    private readonly maskService: SharedMaskService,
  ) {}

  // Encrypt identity value
  encryptValue(value: string) {
    if (!value) {
      this.logger.error('Encrypted value is empty')
    }
    return this.cryptoService.encrypt(
      value,
      this.IDENTITY_ENCRYPTION_KEY,
      this.ENC_ADD,
    )
  }

  // Decrypt identity value
  decryptValue(encryptedValue: string) {
    if (!encryptedValue) {
      this.logger.error('Encrypted value is empty')
    }
    return this.cryptoService.decrypt(
      encryptedValue,
      this.IDENTITY_ENCRYPTION_KEY,
      this.ENC_ADD,
    )
  }

  // Generate value hash for quick lookup
  generateValueHash(value: string) {
    return this.cryptoService.hash(
      value,
      this.IDENTITY_HASH_SALT,
      'hex',
    )
  }

  // Get identity status for a user (like Figure 1)
  // purpose parameter determines whether to get 'login' or 'security' status
  async getUserIdentityStatus(
    userId: string,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    const identities = await this.userIdentityRepoService.findByUserId(userId, dbSession)

    const result: SysUserIdentityStatusResponseDTO = {
      password: { set: false, lastChanged: new Date(0) },
      phoneNumber: {
        bound: false,
        maskedValue: null,
        verified: false,
        status: false,
      },
      emailAddress: {
        bound: false,
        maskedValue: null,
        verified: false,
        status: false,
      },
    }

    for (const identity of identities) {
      const { type, purpose: identityPurpose, maskedValue, verified, createdAt, status } = identity

      // Password has no purpose distinction
      if (type === 'password') {
        result.password = {
          set: true,
          lastChanged: createdAt!,
        }
        continue
      }

      // Only include identities matching the requested purpose
      if ((type === 'phoneNumber' || type === 'emailAddress') && identityPurpose === purpose) {
        result[type] = {
          bound: true,
          maskedValue,
          verified,
          status,
        }
      }
    }

    return result
  }

  // Check if value exists for specific purpose (for registration validation)
  async checkValueExists(
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    value: string,
    dbSession?: ClientSession,
  ) {
    const valueHash = this.generateValueHash(value)
    const existing = await this.userIdentityRepoService.findByValueHash(type, purpose, valueHash, dbSession)
    return !!existing
  }

  // Get encrypted credential for authentication
  async getEncryptedCredential(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    return this.userIdentityRepoService.findByUserIdTypeAndPurpose(
      userId,
      type,
      purpose,
      dbSession,
    )
  }

  // Create identity with auto encryption and hash generation
  async createIdentity(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    value: string,
    dbSession?: ClientSession,
  ) {
    const encryptedValue = this.encryptValue(value)
    const maskedValue = this.maskService.maskIdentityValue(type, value)
    const valueHash = this.generateValueHash(value)

    return this.userIdentityRepoService.createIdentity({
      userId,
      type,
      purpose,
      value: encryptedValue,
      valueHash,
      maskedValue,
      verified: false,
      metadata: {},
    }, dbSession)
  }

  // Mark identity as verified (called after OTP/GitHub/Gitee validation success)
  async verifyIdentity(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    return this.userIdentityRepoService.updateByUserIdTypeAndPurpose(
      userId,
      type,
      purpose,
      {
        verified: true,
        verifiedAt: new Date(),
      },
      dbSession,
    )
  }

  // ============ Helper methods for simplifying service layer ============

  // Get identity by userId, type, purpose - throws if not found
  async getIdentityOrThrow(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    const existing = await this.userIdentityRepoService.findByUserIdTypeAndPurpose(
      userId,
      type,
      purpose,
      dbSession,
    )

    if (!existing) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return existing
  }

  // Get decrypted identifier (value) from identity - throws if not found
  async getDecryptedIdentifier(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
  ) {
    // Step 1: Check if identity exists
    await this.getIdentityOrThrow(userId, type, purpose, dbSession)

    // Step 2: Get encrypted value (select: false field) via dedicated method
    const encryptedValue = await this.userIdentityRepoService.getValueByUserIdTypeAndPurpose(
      userId,
      type,
      purpose,
      dbSession,
    )

    if (isNil(encryptedValue)) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // Step 3: Decrypt the value to get identifier
    return this.decryptValue(encryptedValue)
  }

  // Assert that value does not exist for the given type and purpose
  // Throws if value already exists
  async assertValueNotExists(
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    value: string,
    dbSession?: ClientSession,
    errMsg?: string,
  ) {
    const valueExists = await this.checkValueExists(type, purpose, value, dbSession)
    if (valueExists) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: isNil(errMsg) ? 'business.auth.identityAlreadyUsed' : errMsg })
    }
  }

  // Assert that identity does not exist for the given userId, type, purpose
  // Throws if identity already exists
  async assertIdentityNotExists(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    dbSession?: ClientSession,
    errMsg?: string,
  ) {
    const existing = await this.userIdentityRepoService.findByUserIdTypeAndPurpose(
      userId,
      type,
      purpose,
      dbSession,
    )
    if (existing) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: isNil(errMsg) ? 'business.auth.identityAlreadyBound' : errMsg })
    }
  }

  // Prepare identity value for creation/update (encrypt, hash, mask)
  prepareIdentityValue(
    type: IWalnutAdminConstSysUserIdentityType,
    value: string,
  ) {
    return {
      value: this.encryptValue(value),
      valueHash: this.generateValueHash(value),
      maskedValue: this.maskService.maskIdentityValue(type, value),
    }
  }

  // Get OTP type from identity type
  getOtpType(type: IWalnutAdminConstSysUserIdentityType): IOtpType {
    return type === 'phoneNumber' ? 'sms' : 'email'
  }

  // Verify OTP code, throws if invalid
  async verifyOtpCode(
    type: IWalnutAdminConstSysUserIdentityType,
    identifier: string,
    verifyCode: string,
    userId: string,
  ) {
    const otpType = this.getOtpType(type)
    const codeValid = await this.otpSharedService.verifyCode(otpType, identifier, verifyCode, userId)

    if (!codeValid) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.verifyCodeError' })
    }
  }
}
