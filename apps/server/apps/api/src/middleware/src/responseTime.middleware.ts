import type { NextFunction, RequestHandler } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'

import responseTime from 'response-time'

@Injectable()
export class ResponseTimeMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor() {
    this.middleware = responseTime({ suffix: false })
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
