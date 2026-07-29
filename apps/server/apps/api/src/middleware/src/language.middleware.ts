import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { RequestHeaders } from '@walnut/contract/http'
import { LocaleType, LocaleType } from '@walnut/contract'
import { NextFunction } from 'express'

@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    const reqLang: LocaleType
      = (req.headers[
        RequestHeaders.LANGUAGE
      ] as LocaleType)
      || (req.headers[
        RequestHeaders.LANGUAGE.toLowerCase()
      ] as LocaleType)
      || (req.headers['accept-language'] as LocaleType)
      || this.configService.get<LocaleType>('app.i18n.fallback')

    req.language = reqLang

    next()
  }
}
