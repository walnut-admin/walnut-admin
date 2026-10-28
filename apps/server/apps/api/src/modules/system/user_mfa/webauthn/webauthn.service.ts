import type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  RegistrationResponseJSON,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server'
import type { EntityManager } from 'typeorm'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { WalnutAdminExceptionBadRequest, WalnutAdminExceptionNotFound } from '@walnut-server/exceptions/base.exception'

import { isNil } from 'lodash'
import { AuthMfaPostVerificationService } from '@/modules/auth/modules/mfa/mfa.post.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { SysUserMfaRepositoryService } from '../repo/user_mfa.repo.service'
import { SysUserMfaWebauthnAuthenticateVerifyDTO } from './webauthn.dto'

/**
 * B7b 迁移：Mongo model 直持 → SysUserMfaRepositoryService（PG）。
 *
 * - 4 处 `new Types.ObjectId(userId)` 全部摘除，uuid 直传（phase3-plan §4 B7 项）；
 * - verifyAuthentication 的双句柄（em + dbSession，B7a 签名适配）归一为单 em；
 * - counter 列挂 number transformer（bigint 列，驱动默认返 string）。
 */
@Injectable()
export class SysUserMfaWebauthnService {
  private readonly MFA_ENCRYPTION_KEY = 'crypto.mfaKey'

  private readonly allowedTransports = ['ble', 'nfc', 'internal', 'usb'] as AuthenticatorTransport[]

  // WebAuthn config
  private readonly rpName: string
  private readonly rpID: string
  private readonly origin: string

  constructor(
    private readonly sysUserMfaRepo: SysUserMfaRepositoryService,

    private readonly cacheMfaService: AppTechCacheMfaService,

    private readonly configService: ConfigService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly authMfaPostVerificationService: AuthMfaPostVerificationService,
  ) {
    this.rpName = this.configService.get('app.name')!
    this.rpID = this.configService.get('auth.mfa.webauthn.rpId')!
    this.origin = this.configService.get('auth.mfa.webauthn.origin')!
  }

  /**
   * 生成注册选项
   */
  async generateRegistrationOptions(userId: string, deviceId: string, userName: string, deviceName: string) {
    // 获取用户已有的 WebAuthn 设备
    const existingDevices = await this.sysUserMfaRepo.findActiveWebauthnByUserId(userId)

    // 排除已注册的凭证（webauthn 行必有凭据 id —— uq_user_mfa_credential 语义）
    const excludeCredentials = existingDevices.map(device => ({
      id: device.webauthnCredentialId!,
      transports: this.allowedTransports,
    }))

    const options: GenerateRegistrationOptionsOpts = {
      rpName: this.rpName,
      rpID: this.rpID,
      userName,
      userDisplayName: userName,
      // 不要求用户验证(PIN/生物识别), 只要求用户存在(触摸)
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      excludeCredentials,
      // 支持的算法
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256
    }

    const registrationOptions = await generateRegistrationOptions(options)

    // challenge 临时存储(Redis 或 Session),5分钟过期
    await this.cacheMfaService.setWebauthnCache(
      userId,
      deviceId,
      'registration',
      registrationOptions.challenge,
    )

    return {
      options: registrationOptions,
      deviceName,
    }
  }

  /**
   * 验证注册响应并保存
   */
  async verifyAndSaveRegistration(
    userId: string,
    deviceId: string,
    deviceName: string,
    response: RegistrationResponseJSON,
  ) {
    // 从缓存获取 challenge
    const expectedChallenge = await this.cacheMfaService.getWebauthnCache(userId, deviceId, 'registration')
    if (isNil(expectedChallenge)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    const opts: VerifyRegistrationResponseOpts = {
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: false,
    }

    // P3-5：simplewebauthn 对 malformed response 抛未受控异常（兜底 50000）——
    // 统一包装成受控 40000（verifyFail），原始错误进 _devMsg 供排查
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
    try {
      verification = await verifyRegistrationResponse(opts)
    }
    catch (err) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.auth.mfa.verifyFail',
        _devMsg: err instanceof Error ? err.message : String(err),
      })
    }

    if (isNil(verification.verified) || isNil(verification.registrationInfo)) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    const { credential } = verification.registrationInfo
    const { publicKey, id, counter } = credential

    // 检查凭证是否已存在（凭据 id 全局唯一 —— uq_user_mfa_credential partial unique）
    const existing = await this.sysUserMfaRepo.findWebauthnByCredentialId(id)

    if (existing) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.webauthn.alreadyBound' })
    }

    // 加密公钥存储
    const publicKeyEncrypted = this.cryptoService.encrypt(
      isoBase64URL.fromBuffer(publicKey),
      this.MFA_ENCRYPTION_KEY,
    )

    // 保存到数据库
    await this.sysUserMfaRepo.createMfa({
      userId,
      type: 'webauthn',
      deviceId,
      name: deviceName,
      webauthnCredentialId: id,
      webauthnPublicKey: publicKeyEncrypted,
      webauthnCounter: counter,
      status: true,
    })

    // 清除 challenge 缓存
    await this.cacheMfaService.delWebauthnCache(userId, deviceId, 'registration')

    return true
  }

  /**
   * 生成认证选项
   */
  async generateAuthenticationOptions(userId: string, deviceId: string) {
    // 获取用户的 WebAuthn 设备
    const devices = await this.sysUserMfaRepo.findActiveWebauthnByUserId(userId)

    if (devices.length === 0) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 允许的凭证列表（webauthn 行必有凭据 id —— uq_user_mfa_credential 语义）
    const allowCredentials = devices.map(device => ({
      id: device.webauthnCredentialId!,
      transports: this.allowedTransports,
    }))

    const options: GenerateAuthenticationOptionsOpts = {
      rpID: this.rpID,
      allowCredentials,
      userVerification: 'preferred',
    }

    const authenticationOptions = await generateAuthenticationOptions(options)

    // 缓存 challenge
    await this.cacheMfaService.setWebauthnCache(
      userId,
      deviceId,
      'authentication',
      authenticationOptions.challenge,
    )

    return authenticationOptions
  }

  /**
   * 验证认证响应
   * （B7b 归一：mfa 表写腿迁 PG —— B7a 的双句柄（em + dbSession）收成单 em）
   */
  async verifyAuthentication(
    jti: string,
    deviceId: string,
    user: IWalnutAdminAccessTokenPayload,
    dto: SysUserMfaWebauthnAuthenticateVerifyDTO,
    em?: EntityManager,
  ) {
    // 获取 challenge
    const expectedChallenge = await this.cacheMfaService.getWebauthnCache(user.userId, deviceId, 'authentication')
    if (isNil(expectedChallenge)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // 根据 credentialId 查找设备
    const credentialIdBase64 = dto.response.id
    const device = await this.sysUserMfaRepo.findWebauthnWithPublicKeyByUserIdAndCredentialId(user.userId, credentialIdBase64, em)

    if (!device || device.webauthnPublicKey === null) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 解密公钥
    const decryptedKey = this.cryptoService.decrypt(device.webauthnPublicKey, this.MFA_ENCRYPTION_KEY)

    const opts: VerifyAuthenticationResponseOpts = {
      response: dto.response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        id: device.webauthnCredentialId!, // 字符串 id
        publicKey: isoBase64URL.toBuffer(decryptedKey), // Uint8Array
        counter: device.webauthnCounter,
        transports: this.allowedTransports,
      },
      requireUserVerification: false,
    }

    // P3-5：同 register/verify —— simplewebauthn 异常包装成受控 40000
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    try {
      verification = await verifyAuthenticationResponse(opts)
    }
    catch (err) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.auth.mfa.verifyFail',
        _devMsg: err instanceof Error ? err.message : String(err),
      })
    }

    if (!verification.verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    // 更新 counter 防止重放攻击
    await this.sysUserMfaRepo.updateWebauthnCounterAndLastUsedAt(
      device.id,
      verification.authenticationInfo.newCounter,
      new Date(),
      em,
    )

    // 清除 challenge
    await this.cacheMfaService.delWebauthnCache(user.userId, deviceId, 'authentication')

    // post verification
    // B7b 归一：post verification 全链 PG —— 单 em 透传
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, user.sid!, user.userId, deviceId, em)
  }
}
