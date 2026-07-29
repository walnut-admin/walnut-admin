import type { NextFunction, RequestHandler } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'

@Injectable()
export class CookieParserMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor(
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>('app.cookie.secret')
    this.middleware = cookieParser(secret)
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
