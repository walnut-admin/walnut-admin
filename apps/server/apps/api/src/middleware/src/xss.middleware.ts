import { Injectable, NestMiddleware } from '@nestjs/common'
import { NextFunction } from 'express'
import { xss } from 'express-xss-sanitizer'

@Injectable()
export class XSSMiddleware implements NestMiddleware {
  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    xss()(req, res, next)
  }
}
