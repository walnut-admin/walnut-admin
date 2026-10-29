import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { registerAfterCommitHook } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { isNil } from 'lodash'
import { generateSecret, generateURI, verify } from 'otplib'
import * as QRCode from 'qrcode'
import { AuthMfaPostVerificationService } from '@/modules/auth/modules/mfa/mfa.post.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { SysUserRepositoryService } from '../../user/repo/user.repo.service'
import { SysUserMfaEntity } from '../entity/user-mfa.entity'
import { SysUserMfaHelperService } from '../mfa.shared.service'
import { SysUserMfaRepositoryService } from '../repo/user_mfa.repo.service'
import { SysUserMfaBindTotpDTO, SysUserMfaDeviceVerifyTotpDTO } from './totp.dto'

/**
 * B7b 迁移：Mongo model 直持 → SysUserMfaRepositoryService（PG）。
 *
 * - 9 处 `new Types.ObjectId(userId)` 全部摘除，uuid 直传（phase3-plan §4 B7 项）；
 * - 事务句柄 `dbSession: ClientSession` → `em?: EntityManager`（B7a 的 verify 双句柄
 *   归一为单 em —— mfa 表写腿与 user 读腿同为 PG）；
 * - **备用码并入 totp 行**（phase2 4.12 定案）：不再创建独立 `type: 'backup_codes'` 行
 *   （PG CHECK 只放行 totp/webauthn），绑定时把 hash 后的备用码写进 totp 行的
 *   backup_codes_ciphertext 列；verifyBackupCode / unbindTotp 同步按 totp 行读写。
 */
@Injectable()
export class SysUserMfaTotpService {
  private readonly MFA_ENCRYPTION_KEY = 'crypto.mfaKey'

  private issuer: string

  constructor(
    private readonly sysUserMfaRepo: SysUserMfaRepositoryService,

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
  async generateTotp(userId: string, deviceId: string, em?: EntityManager) {
    const user = await this.userRepo.findUserByUserId(userId, em)

    if (!user) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const existingDevice = await this.sysUserMfaRepo.findActiveTotpByUserId(userId, em)

    if (existingDevice) {
      throw new WalnutAdminExceptionDataExists()
    }

    // generate TOTP secret using v13 API
    const secret = generateSecret()

    //  generate otpauth URI using v13 API
    const otpauthUrl = generateURI({
      strategy: 'totp',
      issuer: this.issuer,
      label: user.userName!,
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
      account: user.userName!,
    }
  }

  /**
   * verify and bind TOTP device
   */
  async bindTotp(userId: string, deviceId: string, dto: SysUserMfaBindTotpDTO, em?: EntityManager) {
    const [cachedUserId, cachedDeviceId] = dto.tempTotpId.split(',')

    if (cachedUserId !== userId || cachedDeviceId !== deviceId) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // check if TOTP device already bound
    const existingTotp = await this.sysUserMfaRepo.findTotpByUserIdAndDeviceId(userId, deviceId, em)

    if (existingTotp) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.mfa.totp.alreadyBound' })
    }

    // cache service get TOTP secret
    const encryptedSecret = await this.cacheMfaService.getTotpCache(userId, deviceId)

    if (isNil(encryptedSecret)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    //  decrypt TOTP secret using crypto service
    const secret = this.cryptoService.decrypt(
      encryptedSecret,
      this.MFA_ENCRYPTION_KEY,
    )

    // verify TOTP code using v13 async API
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

    // generate backup codes
    const backupCodes = this.sysUserMfaDeviceHelperService.generateBackupCodes(10)

    // create totp record：密文 + hash 后的备用码同一行落库（phase2 4.12 定案，
    // 备用码不再是独立 backup_codes 行）。
    // P3-23（2026-10-29）：备用码改用确定性哈希（sha256(domain:userId:code)）后再逐项
    // AES-GCM 加密存 array —— 旧实现的随机盐 hash 校验时必然 miss（备用码不可用）。
    await this.sysUserMfaRepo.createMfa({
      userId,
      type: 'totp',
      deviceId,
      name: dto.name,
      totpSecretCiphertext: encryptedSecret,
      backupCodesCiphertext: backupCodes.map(code =>
        this.cryptoService.encrypt(
          this.sysUserMfaDeviceHelperService.hashBackupCode(userId, code),
          this.MFA_ENCRYPTION_KEY,
        ),
      ),
      status: true,
      lastUsedAt: new Date(),
    }, em)

    // after commit, delete cache
    registerAfterCommitHook(async () => {
      await this.cacheMfaService.delTotpCache(userId, deviceId)
    })

    return {
      backupCodes,
    }
  }

  /**
   * verify TOTP
   * （B7b 归一：mfa 表写腿迁 PG —— B7a 的双句柄（em + dbSession）收成单 em）
   *
   * P3-23（2026-10-29）：复用本端点作为备用码校验通道 —— `code` 先按 TOTP 校验，
   * 失败后回落备用码比对（命中即消费，一次性语义）；两者都不中统一 40000
   * （`business.auth.verifyCodeError`），不再有裸 Nest 异常。命中备用码后的响应与
   * TOTP 成功同形态（同一 post-verification，RT 轮换 + 新 AT）。
   */
  async verifyTotp(jti: string, deviceId: string, user: IWalnutAdminAccessTokenPayload, dto: SysUserMfaDeviceVerifyTotpDTO, em?: EntityManager) {
    // 同一事务内读 secret + 备用码列表并加行锁：并发用同一枚备用码时只有一路能消费
    const totpDevice = await this.sysUserMfaRepo.findTotpWithSecretAndBackupCodesByUserId(user.userId, em, !isNil(em))

    if (!totpDevice || totpDevice.totpSecretCiphertext === null) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    let verified = false

    // 6 位数字串才可能是 TOTP；备用码是 12 位字母数字（3x4），无需交给 otplib
    if (/^\d{6}$/.test(dto.code)) {
      // decrypt TOTP secret using crypto service
      const secret = this.cryptoService.decrypt(
        totpDevice.totpSecretCiphertext,
        this.MFA_ENCRYPTION_KEY,
      )

      // verify TOTP code using v13 async API
      const result = await verify({
        strategy: 'totp',
        secret,
        token: dto.code,
        // v13 uses epochTolerance instead of window
        epochTolerance: 30,
      })

      verified = result.valid
    }

    // TOTP 未命中 → 回落备用码；命中即从列表删除（一次性）
    if (!verified) {
      verified = this.consumeBackupCode(totpDevice, user.userId, dto.code)
    }

    if (!verified) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.verifyCodeError' })
    }

    // update last used time（TOTP 与备用码两条成功路径共用）
    totpDevice.lastUsedAt = new Date()
    await this.sysUserMfaRepo.saveMfa(totpDevice, em)

    // post verification
    // B7b 归一：post verification 全链 PG —— 单 em 透传
    return this.authMfaPostVerificationService.handlePostVerification(dto.trusted, jti, user.sid!, user.userId, deviceId, em)
  }

  /**
   * 校验并消费一枚备用码（P3-23）。
   *
   * 存储侧每项是 `AES-GCM(sha256(domain:userId:formattedCode))`；校验时逐项解密得到
   * 确定性哈希再做常量时间比对。存量绑定（随机盐 HMAC，无法解密）会跳过 —— 它们是
   * 坏数据，只能 unbind 后重新 bind 生成可用备用码（DESIGN-ISSUES P3-23 已登记）。
   *
   * @returns 是否命中并消费（命中时已从列表删除；列表清空则停用该 totp 行）
   */
  private consumeBackupCode(totpDevice: SysUserMfaEntity, userId: string, code: string): boolean {
    const formattedCode = this.sysUserMfaDeviceHelperService.formatBackupCode(code)

    if (!this.sysUserMfaDeviceHelperService.validateBackupCodeFormat(formattedCode)) {
      return false
    }

    const encryptedCodes = totpDevice.backupCodesCiphertext ?? []

    for (let index = 0; index < encryptedCodes.length; index++) {
      let storedHash: string

      try {
        storedHash = this.cryptoService.decrypt(encryptedCodes[index], this.MFA_ENCRYPTION_KEY)
      }
      catch {
        // 旧随机盐 HMAC（64 hex）不是本方案密文 —— 不可迁移，跳过
        continue
      }

      if (!this.sysUserMfaDeviceHelperService.verifyBackupCodeHash(userId, formattedCode, storedHash)) {
        continue
      }

      encryptedCodes.splice(index, 1)
      totpDevice.backupCodesCiphertext = encryptedCodes

      // 全部用完 → 停用 totp 行（原实现的语义保留）
      if (encryptedCodes.length === 0) {
        totpDevice.status = false
      }

      return true
    }

    return false
  }

  /**
   * TODO 伪需求 不存在解绑 只存在禁用和重新绑定
   *  unbind TOTP device（备用码随 totp 行同删，无第二行）
   */
  async unbindTotp(userId: string, em?: EntityManager) {
    const deletedCount = await this.sysUserMfaRepo.deleteByUserIdAndType(userId, 'totp', em)

    if (deletedCount === 0) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return true
  }

  async updateStatus(userId: string, status: boolean, em?: EntityManager) {
    const result = await this.sysUserMfaRepo.updateStatusByUserIdAndType(userId, 'totp', status, em)

    if (!result) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    return true
  }
}
