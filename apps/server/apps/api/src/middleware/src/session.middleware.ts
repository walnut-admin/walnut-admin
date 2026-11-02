import type { NextFunction, RequestHandler } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { defaultCookieOptions } from '@walnut-server/cookie'

import { AppTokenService } from '@walnut-server/token'
import cookieSession from 'cookie-session'

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: AppTokenService,
  ) {
    const secret = this.configService.get('app.session.secret') as string
    const refreshTokenExpireMs = this.tokenService.getRefreshTokenExpireSeconds() * 1000

    this.middleware = cookieSession({
      keys: [secret],
      maxAge: refreshTokenExpireMs,
      ...defaultCookieOptions(),
    })
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
