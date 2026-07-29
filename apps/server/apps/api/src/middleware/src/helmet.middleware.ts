import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, RequestHandler } from 'express'

import helmet from 'helmet'

@Injectable()
export class HelmetMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor() {
    this.middleware = helmet({})
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
