import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import cors from 'cors'

import { NextFunction, RequestHandler } from 'express'

@Injectable()
export class CorsMiddleware implements NestMiddleware {
  private middleware: RequestHandler

  constructor(private readonly configService: ConfigService) {
    const allowOrigin = this.configService.get<string | boolean | string[]>(
      'middleware.cors.allowOrigin',
    )

    const allowMethod = this.configService.get<string[]>(
      'middleware.cors.allowMethod',
    )
    const allowHeader = this.configService.get<string[]>(
      'middleware.cors.allowHeader',
    )

    const corsOptions: cors.CorsOptions = {
      origin: allowOrigin,
      methods: allowMethod,
      allowedHeaders: allowHeader,
      preflightContinue: false,
      credentials: true,
      optionsSuccessStatus: HttpStatus.NO_CONTENT,
    }

    this.middleware = cors(corsOptions)
  }

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction) {
    this.middleware(req, res, next)
  }
}
