import type { NextFunction } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { AppDayjs } from '@walnut-server/utils/dayjs'

import { RequestHeaders } from '@walnut/contract/http'

@Injectable()
export class TimezoneMiddleware implements NestMiddleware {
  constructor() {}

  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const reqTZ = AppDayjs.tz.guess()

    req.headers[RequestHeaders.TIMEZONE] = reqTZ
    req.timezone = reqTZ

    next()
  }
}
