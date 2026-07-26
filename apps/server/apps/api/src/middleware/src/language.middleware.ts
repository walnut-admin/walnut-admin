import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'
import { IWalnutAdminConstAppLanguage } from '@walnut/const/app/lang'
import { NextFunction } from 'express'

@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const reqLang: IWalnutAdminConstAppLanguage
      = (req.headers[
        WalnutAdminConstAppHeaders.LANGUAGE
      ] as IWalnutAdminConstAppLanguage)
      || (req.headers[
        WalnutAdminConstAppHeaders.LANGUAGE.toLowerCase()
      ] as IWalnutAdminConstAppLanguage)
      || (req.headers['accept-language'] as IWalnutAdminConstAppLanguage)
      || this.configService.get<IWalnutAdminConstAppLanguage>('app.i18n.fallback')

    req.language = reqLang

    next()
  }
}
