import { Injectable, NestMiddleware } from '@nestjs/common'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'
import { AppDayjs } from '@walnut/utils/dayjs'

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

    req.headers[WalnutAdminConstAppHeaders.TIMEZONE] = reqTZ
    req.timezone = reqTZ

    next()
  }
}
