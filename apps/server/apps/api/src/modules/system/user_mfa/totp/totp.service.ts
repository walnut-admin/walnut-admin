import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { registerAfterCommitHook, WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions'
import { WalnutAdminExceptionDataExists } from '@walnut/exceptions/base/400'
import { WalnutAdminExceptionDataNotFound } from '@walnut/exceptions/base/404'
import { isNil } from 'lodash'

import { ClientSession, Types } from 'mongoose'
import { generateSecret, generateURI, verify } from 'otplib'
import * as QRCode from 'qrcode'
import { AuthMfaPostVerificationService } from '@/modules/auth/modules/mfa/mfa.post.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { SysUserRepositoryService } from '../../user/repo/user.repo.service'
import { SysUserMfaHelperService } from '../mfa.shared.service'
import { ISysUserMfaModel } from '../schema/user_mfa.schema'
import { SysUserMfaBindTotpDTO, SysUserMfaDeviceVerifyTotpDTO } from './totp.dto'

@Injectable()
export class SysUserMfaTotpService {
  private readonly MFA_ENCRYPTION_KEY = 'crypto.mfaKey'

  private issuer: string

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_MFA)
    private readonly sysUserMfaModel: ISysUserMfaModel,

    private readonly configService: ConfigService,

    private readonly cacheMfaService: AppTechCacheMfaService,

    private readonly sysUserMfaDeviceHelperService: SysUserMfaHelperService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly authMfaPostVerificationService: AuthMfaPostVerificationService,
    private readonly userRepo: SysUserRepositoryService,
  ) {
    this.issuer = this.configService.get('app.name')!
  }

  /**
   * generate TOTP secret and QR code
   */
  async generateTotp(userId: string, deviceId: string, dbSession: ClientSession) {
    const user = await this.userRepo.findUserByUserId(userId, dbSession)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const existingDevice = await this.sysUserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      type: 'totp',
      status: true,
    }).session(dbSession)

    if (existingDevice) {
      throw new WalnutAdminExceptionDataExists()
    }

    // generate TOTP secret using v13 API
    const secret = generateSecret()

    //  generate otpauth URI using v13 API
    const otpauthUrl = generateURI({
      strategy: 'totp',
      issuer: this.issuer,
      label: user.userName,
      secret,
    })

    //  generate QR code
    const qrCode = await QRCode.toDataURL(otpauthUrl, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'H',
    })

    //  encrypt TOTP secret using crypto service
    const encryptedSecret = this.cryptoService.encrypt(
      secret,
      this.MFA_ENCRYPTION_KEY,
    )

    //  cache TOTP secret using cache service
    await this.cacheMfaService.setTotpCache(userId, deviceId, encryptedSecret)

    return {
      totpId: `${userId},${deviceId}`,
      secret,
      qrCode,
      account: user.userName,
    }
  }

  /**
   * verify and bind TOTP device
   */
  async bindTotp(userId: string, deviceId: string, dto: SysUserMfaBindTotpDTO, dbSession: ClientSession) {
    const [cachedUserId, cachedDeviceId] = dto.tempTotpId.split(',')

    if (cachedUserId !== userId || cachedDeviceId !== deviceId) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // 👇 check if TOTP device already bound
    const existingTotp = await this.sysUserMfaModel.findOne({
      userId: new Types.ObjectId(userId),
      type: 'totp',
      deviceId,
    }).session(dbSession)

    if (existingTotp) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.totp.alreadyBound' })
    }

    // 👇 cache service get TOTP secret
    const encryptedSecret = await this.cacheMfaService.getTotpCache(userId, deviceId)

    if (isNil(encryptedSecret)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    //  decrypt TOTP secret using crypto service
    const secret = this.cryptoService.decrypt(
      encryptedSecret,
      this.MFA_ENCRYPTION_KEY,
    )

    // 👇 verify TOTP code using v13 async API
    const result = await verify({
      strategy: 'totp',
      secret,
      token: dto.code,
      // v13 uses epochTolerance instead of window
      // epochTolerance: 30 means ±30 seconds (equivalent to window: 1 with 30s step)
      epochTolerance: 30,
    })

    if (!result.valid) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.verifyCodeError' })
    }

    // NOTICE: create with session, first param need to be an array
    await this.sysUserMfaModel.create([{
      userId: new Types.ObjectId(userId),
      type: 'totp',
      deviceId,
      name: dto.name,
      totpSecretCiphertext: encryptedSecret,
      status: true,
      lastUsedAt: new Date(),
    }], { session: dbSession })

    // 👇 generate backup codes
    const backupCodes = this.sysUserMfaDeviceHelperService.generateBackupCodes(10)

    // 👇 save backup codes（using hash storage, irreversible）
    await this.sysUserMfaModel.create([{
      userId: new Types.ObjectId(userId),
      type: 'backup_codes',
      deviceId,
      name: 'BackupCodes',
      backupCodesCiphertext: backupCodes.map(code =>
        this.cryptoService.hash(code), // hash backup code
      ),
      status: true,
    }], { session: dbSession })

    // after session committed, delete cache
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.delTotpCache(userId, deviceId)
    })

    return {
      backupCodes,
    }
  }

  /**
   * verify TOTP
   */
  async verifyTotp(jti: string, deviceId: string, user: IWalnutAdminAccessTokenPayload, dto: SysUserMfaDeviceVerifyTotpDTO, dbSession: ClientSession) {
    const totpDevice = await this.sysUserMfaModel
      .findOne({
        userId: new Types.ObjectId(user.userId),
        type: 'totp',
        status: true,
      })
      .select('+totpSecretCiphertext')
      .session(dbSession)

    if (!totpDevice) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // 👇 decrypt TOTP secret using crypto service
    const secret = this.cryptoService.decrypt(
      totpDevice.totpSecretCiphertext,
      this.MFA_ENCRYPTION_KEY,
    )

    // 👇 verify TOTP code using v13 async API
    const result = await verify({
      strategy: 'totp',
      secret,
      token: dto.code,
      // v13 uses epochTolerance instead of window
      epochTolerance: 30,
    })

    if (!result.valid) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.verifyCodeError' })
    }

    // 👇 update last used time
    totpDevice.lastUsedAt = new Date()
    await totpDevice.save({ session: dbSession })

    // post verification
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, user.sid!, user.userId, deviceId, dbSession)
  }

  /**
   * TODO: use backup code to recover
   */
  async verifyBackupCode(userId: string, code: string) {
    // 👇 format user input
    const formattedCode = this.sysUserMfaDeviceHelperService.formatBackupCode(code)

    if (!this.sysUserMfaDeviceHelperService.validateBackupCodeFormat(formattedCode)) {
      throw new BadRequestException('备用码格式错误')
    }

    // 查找备用码设备
    const backupDevice = await this.sysUserMfaModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type: 'backup_codes',
        status: true,
      })
      .select('+backupCodesCiphertext')

    if (!backupDevice) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // 👇 hash user input backup code
    const hashedInput = this.cryptoService.hash(formattedCode)

    // 👇 find matching backup code
    const index = backupDevice.backupCodesCiphertext.indexOf(hashedInput)

    if (index === -1) {
      throw new UnauthorizedException('备用码错误或已使用')
    }

    // 👇 remove used backup code
    backupDevice.backupCodesCiphertext.splice(index, 1)

    // 👇 if all backup codes used, disable device
    if (backupDevice.backupCodesCiphertext.length === 0) {
      backupDevice.status = false
    }

    await backupDevice.save()

    return {
      success: true,
      remainingCodes: backupDevice.backupCodesCiphertext.length,
    }
  }

  /**
   * TODO 伪需求 不存在解绑 只存在禁用和重新绑定
   *  unbind TOTP device
   */
  async unbindTotp(userId: string, dbSession: ClientSession) {
    const result = await this.sysUserMfaModel.deleteOne({
      userId: new Types.ObjectId(userId),
      type: 'totp',
    }).session(dbSession)

    if (result.deletedCount === 0) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const backupResult = await this.sysUserMfaModel.deleteOne({
      userId: new Types.ObjectId(userId),
      type: 'backup_codes',
    }).session(dbSession)

    if (backupResult.deletedCount === 0) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return true
  }

  async updateStatus(userId: string, status: boolean, dbSession: ClientSession) {
    const result = await this.sysUserMfaModel.findOneAndUpdate({
      userId: new Types.ObjectId(userId),
      type: 'totp',
    }, {
      status,
    }).session(dbSession)

    if (!result) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return true
  }
}
