import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheMfaService } from '@walnut-server/cache'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { AppTechCryptoService } from '@walnut-server/crypto'
import { WalnutAdminExceptionDuplicateSignIn, WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { SysUserDeviceSharedService, SysUserRepositoryService, SysUserSharedService } from '@walnut-server/identity'
import { AppTokenService } from '@walnut-server/token'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { QueryFailedError } from 'typeorm'
import { AuthSessionService } from '../../session/session.service'
import { AuthRefreshTokenEntity } from '../entity/refresh-token.entity'
import { AuthRefreshRepositoryService } from '../repo/refresh.repo.service'

/**
 * 「未撤销现役行恒恰一行」的部分唯一索引名（DDL：migration 1793370000000）。
 * 应用层与迁移两侧的唯一真源是这里的常量 + 迁移里的同名常量。
 */
const ACTIVE_RT_UNIQUE_INDEX = 'uq_rt_active_device_user'

/**
 * 是否撞了 ACTIVE_RT_UNIQUE_INDEX。
 *
 * 只认该索引名：同表的 uq_jti（jti 全局唯一）冲突是**真 bug**（同一 jti 被签发两次），
 * 翻译成「重复登录」会把故障藏起来。约束名为空（驱动版本差异）时同样不认 ——
 * 宁可走受控 40000 兜底，也不误判语义。
 */
function isActiveRefreshTokenUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false
  }

  const driverError = error.driverError as { code?: string, constraint?: string } | undefined

  return driverError?.code === '23505' && driverError?.constraint === ACTIVE_RT_UNIQUE_INDEX
}

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

  private readonly logger = new Logger(AuthRefreshSharedService.name)

  /**
   * @description check refresh token revoked by deviceId & userId
   *
   * revoke-and-insert 后同维度多行：判「撤销」= 无未撤销现役行（恰一行语义，显式筛
   * revoked=false）；revokeReason 取最近一轮撤销行的值（无行 = 未登录/已清理，同样
   * 判撤销、reason 为 null —— 与单行时代的「查无行 → revoked」语义一致）。
   */
  async getTokenRevokedByDeviceIdAndUserId(deviceId: string, userId: string) {
    const active = await this.authRefreshRepo.findActiveByDeviceIdAndUserId(
      deviceId,
      userId,
    )
    if (active) {
      return {
        revoked: false,
        revokeReason: null,
      }
    }
    const lastRevoked = await this.authRefreshRepo.findByDeviceIdAndUserId(deviceId, userId)
    return {
      revoked: true,
      // 列值域 = WalnutAdminConstRevokeRTType（CHECK 约束），收窄回 const 联合供
      // forceQuitConfig 索引（socket.gateway）
      revokeReason: (lastRevoked?.revokeReason ?? null) as IWalnutAdminConstRevokeRTType | null,
    }
  }

  /**
   * @description find refresh token through jti
   *
   * guard 入口校验腿（非事务、不锁）：查无**或已撤销** → 40102。撤销判定是
   * revoke-and-insert 轮换（2026-10-27）的重放拦截第一道闸 —— 旧行轮换即置
   * `revoked=true (reason=rotate)`，旧 jti 的任何后续请求（重放/错峰迟到）在 guard
   * 层就死，不再进入轮换事务。锁与重放判定的职责下沉到轮换事务（见 getNewAccessToken）。
   */
  async getTokenByJti(jti: string): Promise<string> {
    const target = await this.authRefreshRepo.findByJti(jti)
    if (!target || target.revoked) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }
    // decrypt 是同步方法（AES-GCM 单轮），无需 await
    return this.cryptoService.decrypt(target.encryptedToken, this.RT_ENCRYPTION_KEY)
  }

  /**
   * @description revoke refresh token for user device
   */
  async revokeRTForUserDevice(userId: string, deviceId: string, em?: EntityManager, revokeReason?: IWalnutAdminConstRevokeRTType) {
    return this.authRefreshRepo.updateRevokedAndReason(userId, deviceId, true, em, revokeReason)
  }

  /**
   * @description revoke refresh token for user
   *
   * revoke-and-insert 后同设备多行 —— 按设备去重后逐设备全量撤销（撤销本身按
   * (user, device) 整维度生效，见 updateRevokedAndReason），避免每行重复 update。
   */
  async revokeRTForUser(userId: string, em?: EntityManager, revokeReason?: IWalnutAdminConstRevokeRTType) {
    const allAuthRefreshRecords = await this.authRefreshRepo.findAllRTForUser(userId, em)
    const deviceIds = [...new Set(allAuthRefreshRecords.map(record => record.deviceId))]
    for (const deviceId of deviceIds) {
      await this.authRefreshRepo.updateRevokedAndReason(userId, deviceId, true, em, revokeReason)
    }
  }

  /**
   * @description revoke expired refresh token by expiredAt, used for cron task
   *
   * F-39（顺带修正方法名里的 Cron 拼写错误）：原先 allSettled 之后只取 fulfilled，rejected 被
   * **静默丢弃** —— 过期 RT 每 2 小时重试一次撤销，失败既不进日志也不计入返回数，于是
   * 「过期令牌一直没被撤销」这件事永远不可见。现在逐条打 error（带原因），再汇总一行。
   * 返回值口径不变：仍是**已撤销**的行（调用方按它清理 monitor 在线态）。
   */
  async revokeExpiredRefreshTokenForCronJob() {
    const now = AppDayjs().toDate()
    const result = await this.authRefreshRepo.findExpiredTokens(now)

    const res = await Promise.allSettled(
      result.map(async (doc) => {
        return this.authRefreshRepo.saveRefreshTokenDoc(doc, { revoked: true })
      }),
    )

    const revoked = res.filter(i => i.status === 'fulfilled').map(i => i.value)
    const failed = res.filter((i): i is PromiseRejectedResult => i.status === 'rejected')

    if (failed.length > 0) {
      for (const item of failed) {
        this.logger.error(
          `[CronTaskLog] Failed to revoke an expired refresh token: ${item.reason instanceof Error ? item.reason.stack : String(item.reason)}`,
        )
      }
      this.logger.error(
        `[CronTaskLog] Revoke Expired Refresh Token: ${failed.length}/${res.length} failed, ${revoked.length} revoked. The failed rows stay active and will be retried on the next run.`,
      )
    }

    return revoked
  }

  /**
   * @description used to ban unlimited signin
   *
   * duplicate sign-in 判据按「未撤销现役行」存在性：revoke-and-insert 后同维度恒多行
   * （历轮 revoked 旧行），裸 findOne 取行不确定 —— 必须显式筛 revoked=false，否则
   * 命中旧行会误放行重复登录。轮换不变量「未撤销行恒恰一行」保证该判据恒自洽。
   *
   * F-26：判据是 check-then-act 的读腿，**事务内必须持锁**（与轮换腿的
   * `findByJti(jti, em, { lock: true })` 同口径）—— 锁把「判现役行 → 插/复活行」
   * 串行化，否则两路并发登录各自读到 null 后各插一行，把「恰一行」变成两行。
   * 该维度还没有任何行时锁不到行（PG 无间隙锁），由部分唯一索引
   * uq_rt_active_device_user 兜底（见 generateRefreshToken 的 23505 翻译）。
   */
  async isCurrentUserInThisDeviceHasSignIn(
    userId: string,
    deviceId: string,
    em?: EntityManager,
  ) {
    const active = await this.authRefreshRepo.findActiveByDeviceIdAndUserId(
      deviceId,
      userId,
      em,
      { lock: true },
    )
    return active !== null
  }

  /**
   * @description rotate refresh token —— revoke-and-insert（2026-10-27，取代同 jti 原地换锁）
   *
   * 旧行置 `revoked=true (reason=rotate)`，再 INSERT 新行（新 jti、同 user/device、
   * 新 encrypted_token、新 expired_at），返回新 jti 供调用方回种 RT_JTI cookie。
   * 原地换锁时代 cookie 里的 jti 永远作废不了（无 bearer secret、行却一直未撤销），
   * 重放拦截只能靠入口密文快照比对（P0-1，已废弃）；行级撤销后旧 jti 天然一次性，
   * 快照机制随之摘除。
   */
  private async updateRefreshToken(
    oldDocument: AuthRefreshTokenEntity,
    sessionId: string,
    em?: EntityManager,
  ): Promise<string> {
    // revoke 腿先行：旧 jti 自此一次性（同事务内 findByJti 仍可见，提交后对外即死）
    await this.authRefreshRepo.saveRefreshTokenDoc(
      oldDocument,
      {
        revoked: true,
        revokeReason: WalnutAdminConstRevokeRTType.rotate,
      },
      em,
    )

    const newJti = await this.tokenService.generateJTI()
    const refreshToken = await this.tokenService.generateJwtRefreshToken(newJti, sessionId)
    const encryptedToken = this.cryptoService.encrypt(refreshToken, this.RT_ENCRYPTION_KEY)

    await this.authRefreshRepo.create(
      {
        jti: newJti,
        deviceId: oldDocument.deviceId,
        encryptedToken,
        userId: oldDocument.userId,
        expiredAt: AppDayjs()
          .add(this.tokenService.getRefreshTokenExpireSeconds(), 'seconds')
          .toDate(),
      },
      em,
    )

    return newJti
  }

  /**
   * @description generate refresh token and insert into database
   *
   * F-26：并发安全两道闸
   * 1. **读腿持锁**（isCurrentUserInThisDeviceHasSignIn → findActive...({ lock: true })）：
   *    事务内把「判现役行 → 插/复活行」这组写串行化，正常并发第二路会读到胜者写下的
   *    现役行 → 受控 40109；
   * 2. **DB 部分唯一索引兜底**（uq_rt_active_device_user，migration 1793370000000）：
   *    该维度此前没有任何行时读腿锁不到行（PG 无间隙锁），两路并发会同时走到 INSERT ——
   *    索引让后到者撞 23505，这里翻译成**同一个**受控 40109，而不是裸露的驱动错误。
   *    只认这个索引名：uq_jti 冲突是真正的 bug（jti 重复），不能被改写成「重复登录」。
   * 读腿（findByDeviceIdAndUserId）也带上 em —— 否则它在事务外读，会看到与锁内
   * 判定不一致的快照。
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
      em,
    )

    const expiredAt = AppDayjs()
      .add(this.tokenService.getRefreshTokenExpireSeconds(), 'seconds')
      .toDate()

    try {
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
    catch (error) {
      if (isActiveRefreshTokenUniqueViolation(error)) {
        throw new WalnutAdminExceptionDuplicateSignIn()
      }
      throw error
    }
  }

  /**
   * @description refresh access token and refresh token together
   *
   * B7b 归一：refresh 表（含轮换写腿）与 user/role 读腿同为 PG —— 单 em 单事务，
   * revoke（过期兜底）与 rotate 同回滚。
   *
   * revoke-and-insert（2026-10-27，第三次迭代，取代 P0-1 的入口密文快照比对）：
   * 锁内 `findByJti(jti, em, { lock: true })` 读旧行并校验后，旧行置撤销（reason=rotate）、
   * INSERT 新行 —— 轮换后的旧 jti 在行级永久作废，重放/错峰请求无论何时到达都被
   * 「已撤销」判定拦下（guard 层 getTokenByJti 第一道闸 + 此处锁内读到的撤销行第二道闸）。
   * G1 并发实测驱动：悲观锁只串行化「读校验+撤销+插入」这组写（防并发双插/丢更新），
   * 等锁者醒来读到的是已撤销的旧行 → 受控 40102，恰 1 路成功变为确定性成立
   * （快照比对只挡真正同时到达的请求，错峰到达在入口各读最新快照后都能合法轮换，
   * 实测出过 2×20000，故废弃）。返回 `{ accessToken, jti }` —— jti 是新行 jti，
   * 调用方（refresh / mfa / totp / webauthn 四个 HTTP 端点）必须用它回种 RT_JTI cookie，
   * 否则客户端下次 refresh 拿旧 jti 必 40102。
   */
  async getNewAccessToken(
    jti: string,
    deviceId: string,
    sessionId: string,
    em?: EntityManager,
  ): Promise<{ accessToken: string, jti: string }> {
    // Step 1 - get refresh token record（事务内轮换读腿，持悲观写锁串行化「读校验+
    // 撤销+插入」整组写腿；重放拦截靠行级撤销 —— 等锁者读到的旧行必已 revoked）
    const record = await this.authRefreshRepo.findByJti(jti, em, { lock: true })

    // no record
    if (!record) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    // token revoked（并发/顺序重放：胜者已把旧行置撤销，等锁者读到撤销行在此被拦）
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

    // Step 5 - rotate refresh token（旧行撤销 + 新行插入，同事务；拿新 jti 回种 cookie）
    const newJti = await this.updateRefreshToken(record, sessionId, em)

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

    const accessToken = await this.tokenService.generateJwtAccessToken({ ...tokenPayload, sid: sessionId })

    // return access token + new jti（调用方据此回种 RT_JTI cookie）
    return { accessToken, jti: newJti }
  }
}
