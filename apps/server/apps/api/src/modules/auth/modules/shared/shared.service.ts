import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { SysUserDeviceSharedService } from '@/modules/system/user_device/shared/user_device.shared.service'
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
  ) { }

  /**
   * @description generate auth tokens, return accessToken and refreshToken
   */
  async generateAuthTokens(payload: IWalnutAdminAccessTokenPayload, deviceId: string, em?: EntityManager, sessionKey?: string) {
    // 1. create auth session
    const { sessionId, authSessionKey } = await this.authSessionService.createAuthSession(payload.userId, deviceId, sessionKey)

    this.logger.log(`Auth Session created, sessionId: ${sessionId}, authSessionKey: ${authSessionKey.toString('base64')}`)

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

    return { accessToken, refreshTokenJti, authSessionKey: authSessionKey.toString('base64') }
  }
}
