import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { WalnutAdminExceptionDuplicateSignIn, WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserDeviceSharedService } from '@/modules/system/user_device/shared/user_device.shared.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { AuthSessionService } from '../../session/session.service'
import { AuthRefreshRepositoryService } from '../repo/refresh.repo.service'

/**
 * B7b 迁移：refresh 表写腿迁 PG —— B7a 的双句柄并传（em + dbSession）归一为单
 * `em?: EntityManager`（缺省连接级 manager）。刷新轮换（getNewAccessToken：revoke
 * 旧令牌 + rotate 新令牌 + user/role 读腿）自此在同一个 PG 事务里提交/回滚。
 */
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
      // 列值域 = WalnutAdminConstRevokeRTType（CHECK 约束），收窄回 const 联合供
      // forceQuitConfig 索引（socket.gateway）
      revokeReason: target.revokeReason as IWalnutAdminConstRevokeRTType | null,
    }
  }

  /**
   * @description find refresh token through jti
   *
   * P0-1（2026-10-26 修复）：返回**双值** —— `rawToken`（passport 验签用原文）与
   * `encryptedToken`（入口时刻密文快照，轮换锁内重放比对用）。密文快照是重放判定
   * 的真源而非原文比对：RT JWT 是同 (jti, sid) 的再签发，`iat` 秒级粒度下「同秒轮换」
   * 会产出字节全同的新 token，原文比对在竞态里会静默失效；而 AES-GCM 每次 encryption
   * 随机 IV，任何一次轮换后的密文必然不同 —— 逐字节判定无时序窗。
   */
  async getTokenByJti(jti: string): Promise<{ rawToken: string, encryptedToken: string }> {
    const target = await this.authRefreshRepo.findByJti(jti)
    if (!target) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }
    return {
      // decrypt 是同步方法（AES-GCM 单轮），无需 await
      rawToken: this.cryptoService.decrypt(target.encryptedToken, this.RT_ENCRYPTION_KEY),
      encryptedToken: target.encryptedToken,
    }
  }

  /**
   * @description revoke refresh token for user device
   */
  async revokeRTForUserDevice(userId: string, deviceId: string, em?: EntityManager, revokeReason?: IWalnutAdminConstRevokeRTType) {
    return this.authRefreshRepo.updateRevokedAndReason(userId, deviceId, true, em, revokeReason)
  }

  /**
   * @description revoke refresh token for user
   */
  async revokeRTForUser(userId: string, em?: EntityManager, revokeReason?: IWalnutAdminConstRevokeRTType) {
    const allAuthRefreshRecords = await this.authRefreshRepo.findAllRTForUser(userId, em)
    for (const record of allAuthRefreshRecords) {
      await this.authRefreshRepo.updateRevokedAndReason(userId, record.deviceId, true, em, revokeReason)
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
    em?: EntityManager,
  ) {
    const target = await this.authRefreshRepo.findByDeviceIdAndUserId(
      deviceId,
      userId,
      em,
    )
    if (!target)
      return false
    return !target.revoked
  }

  /**
   * @description update refresh token
   */
  private async updateRefreshToken(jti: string, sessionId: string, userId: string, em?: EntityManager) {
    const oldDocument = await this.authRefreshRepo.findByJti(jti, em, { lock: true })
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
      em,
    )
  }

  /**
   * @description generate refresh token and insert into database
   */
  async generateRefreshToken(
    userId: string,
    deviceId: string,
    sessionId: string,
    em?: EntityManager,
  ) {
    if (await this.isCurrentUserInThisDeviceHasSignIn(userId, deviceId, em)) {
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
        em,
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
        em,
      )

      return jti
    }
  }

  /**
   * @description refresh access token and refresh token together
   *
   * B7b 归一：refresh 表（含轮换写腿）与 user/role 读腿同为 PG —— 单 em 单事务，
   * revoke（过期兜底）与 rotate 同回滚。
   *
   * P0-1（2026-10-26 修复）：`presentedEncryptedToken` 是请求入口时刻的
   * `encrypted_token` 快照（refresh 端点 = JwtRefreshGuard 查行时挂
   * `request.realRefreshTokenEncrypted` 的值）。轮换持锁比对「入口快照 vs 库中当前值」：
   * 首个胜者原地覆盖密文后，其余持旧快照的并发请求解锁后读到新密文、比对失配 →
   * 受控 40102；「用已轮换旧快照顺序重放」同样被拦。AES-GCM 随机 IV 保证轮换后密文
   * 必变（RT JWT 同秒再签发会字节全同，故不能比对原文，见 getTokenByJti 注释）。
   * 拿不到快照的内部调用方（MFA/TOTP/WebAuthn post-verification，客户端只持 jti
   * cookie、不走 JwtRefreshGuard）传 `undefined` 跳过比对，重放拦截由 refresh 端点承担。
   */
  async getNewAccessToken(
    jti: string,
    deviceId: string,
    sessionId: string,
    presentedEncryptedToken: string | undefined,
    em?: EntityManager,
  ) {
    // Step 1 - get refresh token record（事务内轮换读腿，持悲观写锁串行化轮换写腿；
    // 重放拦截靠下面的呈献快照比对，见 P0-1）
    const record = await this.authRefreshRepo.findByJti(jti, em, { lock: true })

    // no record
    if (!record) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // P0-1 呈献快照比对（锁内逐字节比字符串，无解密、零时序窗）：放在过期兜底腿
    // 之前 —— 比对失配说明呈献的是旧轮次快照，直接受控拒绝，不触发本轮 revoke 副作用
    if (
      presentedEncryptedToken !== undefined
      && record.encryptedToken !== presentedEncryptedToken
    ) {
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
        record.userId,
        record.deviceId,
        em,
      )
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // Step 2 - get user with user id
    const user = await this.sysUserRepoService.findUserByUserId(record.userId, em)
    if (!user) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // Step 2.5 - populate role infos（junction 组装，对照 Mongo 版 populate virtual）
    const populatedUser = await this.sysUserSharedService.getUserWithPopulatedRoles(user, em)

    // Step 3 - check user status
    await this.sysUserSharedService.checkUserAndRoleStatus(populatedUser)

    // Step 3.5 - check user device trusted status
    const isTrusted = await this.sysUserDeviceSharedService.getUserDeviceTrusted(
      record.userId,
      record.deviceId,
    )

    // Step 4 - construct access token payload
    const tokenPayload = await this.tokenService.getJwtAccessTokenPayload(populatedUser, { isTrusted })

    // Step 5 - update refresh token as well
    await this.updateRefreshToken(jti, sessionId, record.userId, em)

    // Step 6 - touch auth session ttl
    await this.authSessionService.touchAuthSessionTTL(
      record.userId,
      record.deviceId,
      sessionId,
    )

    // Step 7 - touch MFA verified cache TTL
    await this.cacheMfaService.touchVerifiedCache(
      record.userId,
      record.deviceId,
    )

    const newAT = await this.tokenService.generateJwtAccessToken({ ...tokenPayload, sid: sessionId })

    // return access token
    return newAT
  }
}
