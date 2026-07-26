import { Injectable, NestMiddleware } from '@nestjs/common'
import compression from 'compression'

import { NextFunction, RequestHandler } from 'express'

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor() {
    this.middleware = compression()
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
