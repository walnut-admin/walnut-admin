import { promisify } from 'node:util'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuthSessionService } from '@walnut-server/auth'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { SysDeviceRepositoryService } from '@walnut-server/system'
import { AppTokenService } from '@walnut-server/token'
import { RequestHeaders } from '@walnut/contract/http'
import cookieParser from 'cookie-parser'
import { ISocket } from './socket'

/**
 * F-02（P0，2026-11-02）：握手校验从「只 decode 不验签」升级为与 HTTP 侧
 * jwt-access.strategy 同款三重校验 —— 验签名 + 过期（tokenService.verifyAccessToken，
 * verifyAsync）+ Redis 会话键存在性（AuthSessionService，登出 / 吊销 / 伪造 AT 一律拒）。
 * 缺 device cookie 或 payload.sid 无法构造会话键时同样拒绝，不做降级。
 * 组装点在 app 侧（可自由 import libs）；libs/token 只提供验签，不反向依赖 auth。
 */
@Injectable()
export class SocketAuthMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: AppTokenService,
    private readonly authSessionService: AuthSessionService,
    // 拍板-4：设备封禁/锁定后不允许建立实时连接
    private readonly cacheDeviceService: AppTechCacheDeviceService,
    private readonly deviceRepo: SysDeviceRepositoryService,
  ) {}

  /**
   * 设备状态闸门（拍板-4）：缓存优先、miss 回源 DB —— 与 HTTP 侧 DeviceGuard 同口径。
   * 返回 null = 设备行不存在（与 guard 的 40605 对应）。
   */
  private async getDeviceState(deviceId: string) {
    const cached = await this.cacheDeviceService.getSysDeviceCache(deviceId)

    if (cached) {
      return { banned: cached.banned, locked: cached.locked }
    }

    const dbDevice = await this.deviceRepo.findDeviceByDeviceId(deviceId)

    if (!dbDevice) {
      return null
    }

    await this.cacheDeviceService.setSysDeviceCache(dbDevice)

    return { banned: dbDevice.banned, locked: dbDevice.locked }
  }

  private async parseCookie(req: IWalnutAdminExpressRequest) {
    const cookieSecret = this.configService.get<string>('app.cookie.secret')
    const parser = promisify(cookieParser(cookieSecret))
    await parser(req, {} as IWalnutAdminExpressResponse)
  }

  async middleware(socket: ISocket, next: (err?: Error) => void) {
    try {
      // 1. get cookies
      const req = socket.request as IWalnutAdminExpressRequest
      await this.parseCookie(req)
      const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)

      // 2. get access token from handshake headers
      const authHeader = socket.handshake.headers.authorization?.replace('Bearer ', '') as string
      if (!authHeader)
        return next(new Error('Missing Bearer token'))

      // 3. get fingerprint from handshake headers
      const fingerprint = req.headers[RequestHeaders.FINGERPRINT.toLocaleLowerCase()] as string
      if (!fingerprint)
        return next(new Error('Missing fingerprint'))

      // 4. verify (signature + expiry) — F-02 前这里是 decodeAccessToken（不验签）
      const payload = await this.tokenService.verifyAccessToken(authHeader)

      if (!payload)
        return next(new Error('Invalid access token'))

      // 5. session key existence — 与 jwt-access.strategy.validate 的第三重对齐
      const sessionKeyHash = payload.sid == null || deviceId == null
        ? null
        : await this.authSessionService.getAuthSessionKeyHash(payload.userId, deviceId, payload.sid)

      if (!sessionKeyHash)
        return next(new Error('Invalid access token'))

      // 5.5 device state — 拍板-4：封禁 / 锁定的设备不允许握手（原先只验 JWT + 会话键，
      // 已封设备照常建连收实时事件）。与 HTTP 侧同口径：行不存在按「设备不可用」拒绝。
      const deviceState = await this.getDeviceState(deviceId)

      if (!deviceState) {
        return next(new Error('Device not acceptable'))
      }

      if (deviceState.banned) {
        return next(new Error('Device banned'))
      }

      if (deviceState.locked) {
        return next(new Error('Device locked'))
      }

      // 6. hang to socket.data
      socket.data = {
        userId: payload.userId,
        deviceId,
        fingerprint,
      }

      next()
    }
    catch (e) {
      next(e as Error)
    }
  }
}
