import type { NextFunction } from 'express'
import path from 'node:path'
import { Injectable, NestMiddleware } from '@nestjs/common'
import serveFavicon from 'serve-favicon'

@Injectable()
export class FaviconMiddleware implements NestMiddleware {
  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    serveFavicon(path.join(__dirname, '../../public/favicon.ico'))(req, res, next)
  }
}
