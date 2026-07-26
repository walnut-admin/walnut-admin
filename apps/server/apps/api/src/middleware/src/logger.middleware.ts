import { Injectable, Logger, NestMiddleware } from '@nestjs/common'
import { isProd } from '@walnut/config/utils/env'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'
import { LoggerContextService } from '@walnut/context'
import { maskSensitiveFields } from '@walnut/utils/mask'
import { Recordable } from 'easy-fns-ts'
import { NextFunction } from 'express'
import { SharedBLPathService } from '@/modules/shared/BLPath/BLPath.service'

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggerMiddleware.name)

  constructor(
    private readonly sharedBLPathService: SharedBLPathService,
    private readonly loggerContextService: LoggerContextService,
  ) {}

  use(req: IWalnutAdminExpressRequest, res: IWalnutAdminExpressResponse, next: NextFunction): void {
    if (this.sharedBLPathService.shouldSkip(req.path)) {
      return next()
    }

    const requestId = req.id

    this.loggerContextService.run({ requestId }, () => {
      // 1. Request开�?
      this.logger.log('Request Start', {
        context: LoggerMiddleware.name,
        type: 'REQUEST_START',
        requestId,
        // 【改动】嵌套结�?
        request: {
          method: req.method,
          // 【修复】originalUrl 通常�?baseUrl 更完整，包含 querystring 之前的路�?
          url: req.originalUrl || req.baseUrl,
          ip: req.realIp,
          userAgent: req.userAgent?.ua,
        },
      })

      res.once('finish', () => {
        const resTime = res.getHeader(WalnutAdminConstAppHeaders.RES_TIME) as number || 0

        // 2. RequestEnd
        this.logger.log('Request End', {
          context: LoggerMiddleware.name,
          type: 'REQUEST_END',
          requestId,
          request: {
            method: req.method,
            url: req.originalUrl || req.baseUrl,
            query: isProd ? maskSensitiveFields(req.query) : req.query,
            params: isProd ? maskSensitiveFields(req.params) : req.params,
            body: isProd ? maskSensitiveFields(req.body) : req.body as Recordable,
          },
          response: {
            statusCode: res.statusCode,
            timeMs: Number.parseFloat(`${resTime}`),
          },
        })
      })

      next()
    })
  }
}
