import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { WalnutAdminConstAppHeaders } from '@walnut-server/const/app/header'
import { getPackageJsonData } from '@walnut-server/utils/pkg'
import { NextFunction } from 'express'

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

    req.headers[WalnutAdminConstAppHeaders.VERSION] = version
    req.version = version

    req.headers[WalnutAdminConstAppHeaders.REPO_VERSION] = pkg.version as string
    req.repoVersion = pkg.version as string

    next()
  }
}
