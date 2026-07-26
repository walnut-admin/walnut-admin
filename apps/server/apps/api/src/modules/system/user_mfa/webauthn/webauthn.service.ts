import type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  RegistrationResponseJSON,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server'
import { Injectable } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminExceptionBadRequest, WalnutAdminExceptionNotFound } from '@walnut/exceptions/base.exception'
import { isNil } from 'lodash'

import { ClientSession, Types } from 'mongoose'
import { AuthMfaPostVerificationService } from '@/modules/auth/modules/mfa/mfa.post.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { ISysUserMfaModel } from '../schema/user_mfa.schema'
import { SysUserMfaWebauthnAuthenticateVerifyDTO } from './webauthn.dto'

@Injectable()
export class SysUserMfaWebauthnService {
  private readonly MFA_ENCRYPTION_KEY = 'crypto.mfaKey'

  private readonly allowedTransports = ['ble', 'nfc', 'internal', 'usb'] as AuthenticatorTransport[]

  // WebAuthn config
  private readonly rpName: string
  private readonly rpID: string
  private readonly origin: string

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_MFA)
    private readonly sysUserMfaModel: ISysUserMfaModel,

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
    // 获取用户已有�?WebAuthn 设备
    const existingDevices = await this.sysUserMfaModel.find({
      userId: new Types.ObjectId(userId),
      type: 'webauthn',
      status: true,
    })

    // 排除已注册的凭证
    const excludeCredentials = existingDevices.map(device => ({
      id: device.webauthnCredentialId,
      transports: this.allowedTransports,
    }))

    const options: GenerateRegistrationOptionsOpts = {
      rpName: this.rpName,
      rpID: this.rpID,
      userName,
      userDisplayName: userName,
      // 不要求用户验�?PIN/生物识别), 只要求用户存�?触摸)
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      excludeCredentials,
      // 支持的算�?
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256
    }

    const registrationOptions = await generateRegistrationOptions(options)

    // �?challenge 临时存储(Redis �?Session),5分钟过期
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
   * 验证注册响应并保�?
   */
  async verifyAndSaveRegistration(
    userId: string,
    deviceId: string,
    deviceName: string,
    response: RegistrationResponseJSON,
  ) {
    // 从缓存获�?challenge
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

    const verification = await verifyRegistrationResponse(opts)

    if (isNil(verification.verified) || isNil(verification.registrationInfo)) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    const { credential } = verification.registrationInfo
    const { publicKey, id, counter } = credential

    // 检查凭证是否已存在
    const existing = await this.sysUserMfaModel.findOne({
      webauthnCredentialId: id,
    })

    if (existing) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.webauthn.alreadyBound' })
    }

    // 加密公钥存储
    const publicKeyEncrypted = this.cryptoService.encrypt(
      isoBase64URL.fromBuffer(publicKey),
      this.MFA_ENCRYPTION_KEY,
    )

    // 保存到数据库
    await this.sysUserMfaModel.create({
      userId: new Types.ObjectId(userId),
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
    // 获取用户�?WebAuthn 设备
    const devices = await this.sysUserMfaModel.find({
      userId: new Types.ObjectId(userId),
      type: 'webauthn',
      status: true,
    })

    if (devices.length === 0) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 允许的凭证列�?
    const allowCredentials = devices.map(device => ({
      id: device.webauthnCredentialId,
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
   */
  async verifyAuthentication(
    jti: string,
    deviceId: string,
    user: IWalnutAdminAccessTokenPayload,
    dto: SysUserMfaWebauthnAuthenticateVerifyDTO,
    dbSession: ClientSession,
  ) {
    // 获取 challenge
    const expectedChallenge = await this.cacheMfaService.getWebauthnCache(user.userId, deviceId, 'authentication')
    if (isNil(expectedChallenge)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // 根据 credentialId 查找设备
    const credentialIdBase64 = dto.response.id
    const device = await this.sysUserMfaModel
      .findOne({
        userId: new Types.ObjectId(user.userId),
        webauthnCredentialId: credentialIdBase64,
        type: 'webauthn',
        status: true,
      })
      .select('+webauthnPublicKey')
      .session(dbSession)

    if (!device || !device.webauthnPublicKey) {
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
        id: device.webauthnCredentialId, // 字符?id
        publicKey: isoBase64URL.toBuffer(decryptedKey), // Uint8Array
        counter: device.webauthnCounter,
        transports: this.allowedTransports,
      },
      requireUserVerification: false,
    }

    const verification = await verifyAuthenticationResponse(opts)

    if (!verification.verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.verifyFail' })
    }

    // 更新 counter 防止重放攻击
    await this.sysUserMfaModel.updateOne(
      { _id: device._id },
      {
        webauthnCounter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    ).session(dbSession)

    // 清除 challenge
    await this.cacheMfaService.delWebauthnCache(user.userId, deviceId, 'authentication')

    // post verification
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, user.sid!, user.userId, deviceId, dbSession)
  }
}
