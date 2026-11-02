import { promisify } from 'node:util'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuthSessionService } from '@walnut-server/auth'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
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
  ) {}

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
