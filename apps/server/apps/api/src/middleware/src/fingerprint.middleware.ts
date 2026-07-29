import { Injectable, NestMiddleware } from '@nestjs/common'
import { RequestHeaders } from '@walnut/contract/http'
import { NextFunction } from 'express'

@Injectable()
export class FingerprintMiddleware implements NestMiddleware {
  constructor() {}

  use(req: IWalnutAdminExpressRequest, _res: IWalnutAdminExpressResponse, next: NextFunction) {
    const fp = req.headers[RequestHeaders.FINGERPRINT.toLocaleLowerCase()] as string
    req.fingerprint = fp

    next()
  }
}
