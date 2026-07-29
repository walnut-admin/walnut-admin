import { Injectable, NestMiddleware } from '@nestjs/common'
import * as requestIp from '@supercharge/request-ip'
import { RequestHeaders } from '@walnut/contract/http'
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

    req.headers[RequestHeaders.IP] = ip
    req.realIp = ip!

    next()
  }
}
