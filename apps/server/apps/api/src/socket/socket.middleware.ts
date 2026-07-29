import { promisify } from 'node:util'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { RequestHeaders } from '@walnut/contract/http'
import cookieParser from 'cookie-parser'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { ISocket } from './socket'

@Injectable()
export class SocketAuthMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: AppTokenService,
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

      // 4. verify & get token payload
      const payload = await this.tokenService.decodeAccessToken(authHeader)

      if (!payload)
        return next(new Error('Invalid access token'))

      // 5. hang to socket.data
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
