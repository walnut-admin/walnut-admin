import { Injectable, NestMiddleware } from '@nestjs/common'
import { RequestHeaders } from '@walnut/contract/http'
import { AppDayjs } from '@walnut-server/utils/dayjs'

import { NextFunction } from 'express'

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
