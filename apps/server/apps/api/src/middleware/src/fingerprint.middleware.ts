import { Injectable, NestMiddleware } from '@nestjs/common'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'
import { NextFunction } from 'express'

@Injectable()
export class FingerprintMiddleware implements NestMiddleware {
  constructor() {}

  use(req: IWalnutAdminExpressRequest, _res: IWalnutAdminExpressResponse, next: NextFunction) {
    const fp = req.headers[WalnutAdminConstAppHeaders.FINGERPRINT.toLocaleLowerCase()] as string
    req.fingerprint = fp

    next()
  }
}
