import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { RequestHeaders } from '@walnut/contract/http'
import { getPackageJsonData } from '@walnut-server/utils/pkg'
import type { NextFunction } from 'express'

const pkg = getPackageJsonData()
@Injectable()
export class VersionMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const version = this.configService.get<string>('app.api.version')!

    req.headers[RequestHeaders.VERSION] = version
    req.version = version

    req.headers[RequestHeaders.REPO_VERSION] = pkg.version as string
    req.repoVersion = pkg.version as string

    next()
  }
}
