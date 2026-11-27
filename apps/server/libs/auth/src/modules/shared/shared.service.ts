import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { SysUserDeviceSharedService, SysUserLockService } from '@walnut-server/identity'
import { AppTokenService } from '@walnut-server/token'
import { AuthRefreshSharedService } from '../refresh/shared/refresh.shared.service'
import { AuthSessionService } from '../session/session.service'

/**
 * B7b 归一：refresh 写腿（generateRefreshToken）迁 PG —— 事务句柄
 * `dbSession: ClientSession` → `em?: EntityManager`（controller 传 ctx.em）。
 */
@Injectable()
export class AuthSharedService {
  private readonly logger = new Logger(AuthSharedService.name)

  constructor(
    private readonly tokenService: AppTokenService,
    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly userDeviceSharedService: SysUserDeviceSharedService,
    private readonly authSessionService: AuthSessionService,
    private readonly userLockService: SysUserLockService,
  ) { }

  /**
   * @description generate auth tokens, return accessToken and refreshToken
   */
  async generateAuthTokens(payload: IWalnutAdminAccessTokenPayload, deviceId: string, em?: EntityManager, sessionKey?: string) {
    // 1. create auth session
    const { sessionId, authSessionKey } = await this.authSessionService.createAuthSession(payload.userId, deviceId, sessionKey)

    // F-06：sessionKey 是会话签名派生根密钥（Redis 只存哈希、原文只回传给客户端一次）；
    // 打 sessionId 足以定位会话，打 key 等于把会话根密钥写进轮转日志。
    this.logger.log(`Auth Session created, sessionId: ${sessionId}`)

    // 2. generate access token with sid
    const accessToken = await this.tokenService.generateJwtAccessToken({ ...payload, sid: sessionId })
    this.logger.log(`Access Token created`)

    // 3. generate refresh token jti with sid
    const refreshTokenJti = await this.authRefreshSharedService.generateRefreshToken(payload.userId, deviceId, sessionId, em)
    this.logger.log(`Refresh Token JTI created, refreshTokenJti: ${refreshTokenJti}`)

    // 4. bind current device to user
    // （B7c 归一：user_device 写腿收进同一 PG 事务 —— refresh（步骤 3）与设备绑定
    // 联动原子提交/回滚，B7 核心验收「登录 refresh + device 同事务」的最后一腿）
    const bindedDevice = await this.userDeviceSharedService.bindDeviceForUser(payload.userId, deviceId, em)
    this.logger.log(`User Device bound, deviceId: ${bindedDevice.deviceId}`)

    // 5. I3 方案②（L1，2026-11-27）：完整登录 = 身份重新证明 ⇒ 按 lockCrossDevice 自动解锁。
    //    放在设备绑定之后（单设备分支要更新本设备行）；所有登录通道（OPAQUE / OTP /
    //    Google / GitHub / Gitee）都经过本方法，语义同构。
    //    DuplicateSignIn 组合：同 (userId, deviceId) 有现役 RT 时步骤 3 已抛 40109，
    //    本步骤只在「换设备登录」或「先 signout 再登录」时可达 —— 都是真实的新凭据证明。
    //    登录链路全部挂 @WalnutTx，输出腿的 after-commit 缓存写安全。
    await this.userLockService.unlockOnLoginSuccess(payload.userId, deviceId, em)

    return { accessToken, refreshTokenJti, authSessionKey: authSessionKey.toString('base64') }
  }
}
