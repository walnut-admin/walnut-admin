import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminExceptionDuplicateSignIn, WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { ClientSession } from 'mongoose'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserDeviceSharedService } from '@/modules/system/user_device/shared/user_device.shared.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { AuthSessionService } from '../../session/session.service'
import { AuthRefreshRepositoryService } from '../repo/refresh.repo.service'

@Injectable()
export class AuthRefreshSharedService {
  private readonly RT_ENCRYPTION_KEY = 'crypto.rtKey'

  constructor(
    private readonly authRefreshRepo: AuthRefreshRepositoryService,

    private readonly cacheMfaService: AppTechCacheMfaService,

    private readonly sysUserDeviceSharedService: SysUserDeviceSharedService,
    private readonly tokenService: AppTokenService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * @description check refresh token revoked by deviceId & userId
   */
  async getTokenRevokedByDeviceIdAndUserId(deviceId: string, userId: string) {
    const target = await this.authRefreshRepo.findByDeviceIdAndUserId(
      deviceId,
      userId,
    )
    if (!target) {
      return {
        revoked: true,
        revokeReason: null,
      }
    }
    return {
      revoked: target.revoked,
      revokeReason: target.revokeReason,
    }
  }

  /**
   * @description find refresh token through jti
   */
  async getTokenByJti(jti: string) {
    const target = await this.authRefreshRepo.findByJti(jti)
    if (!target) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }
    return this.cryptoService.decrypt(target.encryptedToken, this.RT_ENCRYPTION_KEY)
  }

  /**
   * @description revoke refresh token for user device
   */
  async revokeRTForUserDevice(userId: string, deviceId: string, dbSession: ClientSession, revokeReason?: IWalnutAdminConstRevokeRTType) {
    return this.authRefreshRepo.updateRevokedAndReason(userId, deviceId, true, dbSession, revokeReason)
  }

  /**
   * @description revoke refresh token for user
   */
  async revokeRTForUser(userId: string, dbSession: ClientSession, revokeReason?: IWalnutAdminConstRevokeRTType) {
    const allAuthRefreshRecords = await this.authRefreshRepo.findAllRTForUser(userId, dbSession)
    for (const record of allAuthRefreshRecords) {
      await this.authRefreshRepo.updateRevokedAndReason(userId, record.deviceId, true, dbSession, revokeReason)
    }
  }

  /**
   * @description revoke expired refresh token by expiredAt, used for cron task
   */
  async revokeExpiredRefreshTokenForCrobJob() {
    const now = AppDayjs().toDate()
    const result = await this.authRefreshRepo.findExpiredTokens(now)

    const res = await Promise.allSettled(
      result.map(async (doc) => {
        return this.authRefreshRepo.saveRefreshTokenDoc(doc, { revoked: true })
      }),
    )

    return res.filter(i => i.status === 'fulfilled').map(i => i.value)
  }

  /**
   * @description used to ban unlimited signin
   */
  async isCurrentUserInThisDeviceHasSignIn(
    userId: string,
    deviceId: string,
    dbSession: ClientSession,
  ) {
    const target = await this.authRefreshRepo.findByDeviceIdAndUserId(
      deviceId,
      userId,
      dbSession,
    )
    if (!target)
      return false
    return !target.revoked
  }

  /**
   * @description update refresh token
   */
  private async updateRefreshToken(jti: string, sessionId: string, userId: string, dbSession: ClientSession) {
    const oldDocument = await this.authRefreshRepo.findByJti(jti, dbSession)
    if (!oldDocument)
      return

    const refreshToken = await this.tokenService.generateJwtRefreshToken(jti, sessionId)
    const encryptedToken = this.cryptoService.encrypt(refreshToken, this.RT_ENCRYPTION_KEY)

    await this.authRefreshRepo.saveRefreshTokenDoc(
      oldDocument,
      {
        expiredAt: AppDayjs()
          .add(this.tokenService.getRefreshTokenExpireSeconds(), 'seconds')
          .toDate(),
        encryptedToken,
      },
      dbSession,
    )
  }

  /**
   * @description generate refresh token and insert into database
   */
  async generateRefreshToken(
    userId: string,
    deviceId: string,
    sessionId: string,
    dbSession: ClientSession,
  ) {
    if (await this.isCurrentUserInThisDeviceHasSignIn(userId, deviceId, dbSession)) {
      throw new WalnutAdminExceptionDuplicateSignIn()
    }

    const oldDocument = await this.authRefreshRepo.findByDeviceIdAndUserId(
      deviceId,
      userId,
    )

    const expiredAt = AppDayjs()
      .add(this.tokenService.getRefreshTokenExpireSeconds(), 'seconds')
      .toDate()

    if (oldDocument) {
      const refreshToken = await this.tokenService.generateJwtRefreshToken(
        oldDocument.jti,
        sessionId,
      )
      const encryptedToken = this.cryptoService.encrypt(refreshToken, this.RT_ENCRYPTION_KEY)

      await this.authRefreshRepo.saveRefreshTokenDoc(
        oldDocument,
        {
          expiredAt,
          encryptedToken,
          revoked: false,
        },
        dbSession,
      )

      return oldDocument.jti
    }
    else {
      const jti = await this.tokenService.generateJTI()
      const refreshToken = await this.tokenService.generateJwtRefreshToken(jti, sessionId)
      const encryptedToken = this.cryptoService.encrypt(refreshToken, this.RT_ENCRYPTION_KEY)

      await this.authRefreshRepo.create(
        {
          jti,
          deviceId,
          encryptedToken,
          userId,
          expiredAt,
        },
        dbSession,
      )

      return jti
    }
  }

  /**
   * @description refresh access token and refresh token together
   */
  async getNewAccessToken(jti: string, deviceId: string, sessionId: string, dbSession: ClientSession) {
    // Step 1 - get refresh token record
    const record = await this.authRefreshRepo.findByJti(jti, dbSession)

    // no record
    if (!record) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // token revoked
    if (record.revoked) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // device id not match
    if (record.deviceId !== deviceId) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // refresh token expired
    // manually revoke it
    if (AppDayjs(record.expiredAt).isBefore(AppDayjs())) {
      await this.revokeRTForUserDevice(
        record.userId.toString(),
        record.deviceId.toString(),
        dbSession,
      )
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // Step 2 - get user with user id
    const user = await this.sysUserRepoService.findUserByUserId(record.userId.toString(), dbSession)
    if (!user) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // Step 2.5 - populate role infos
    const populatedUser = await user.populate({ path: WalnutDBVirtualName.ROLES_LIST })

    // Step 3 - check user status
    await this.sysUserSharedService.checkUserAndRoleStatus(populatedUser)

    // Step 3.5 - check user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(
      record.userId.toString(),
      record.deviceId,
      dbSession,
    )

    // Step 4 - construct access token payload
    const tokenPayload = await this.tokenService.getJwtAccessTokenPayload(populatedUser, { isTrusted })

    // Step 5 - update refresh token as well
    await this.updateRefreshToken(jti, sessionId, record.userId.toString(), dbSession)

    // Step 6 - touch auth session ttl
    await this.authSessionService.touchAuthSessionTTL(
      record.userId.toString(),
      record.deviceId,
      sessionId,
    )

    // Step 7 - touch MFA verified cache TTL
    await this.cacheMfaService.touchVerifiedCache(
      record.userId.toString(),
      record.deviceId,
    )

    const newAT = await this.tokenService.generateJwtAccessToken({ ...tokenPayload, sid: sessionId })

    // return access token
    return newAT
  }
}
