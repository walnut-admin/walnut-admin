import { Injectable, NestMiddleware } from '@nestjs/common'
import * as requestIp from '@supercharge/request-ip'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'
import { NextFunction } from 'express'

@Injectable()
export class IpMiddleware implements NestMiddleware {
  constructor() {}

  async use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const ip = requestIp.getClientIp(req)

    req.headers[WalnutAdminConstAppHeaders.IP] = ip
    req.realIp = ip!

    next()
  }
}
