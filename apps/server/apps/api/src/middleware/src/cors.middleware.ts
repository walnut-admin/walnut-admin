import type { NextFunction, RequestHandler } from 'express'
import { HttpStatus, Injectable, Logger, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import cors from 'cors'

/**
 * CORS 中间件。
 *
 * F-43（2026-11，安全纵深）：allowOrigin 的取值由 `middleware.config.ts` 决定 ——
 * dev / stage 是显式白名单（127.0.0.1 / localhost 的常用端口），生产是 www 单源，
 * 两者都可被 `APP_CORS_ALLOW_ORIGINS` 覆盖。**不再回 `*`**：
 * CORS 规范里 `Access-Control-Allow-Origin: *` 与 `credentials: true` 互斥，
 * 全站 cookie 认证 + credentials:true 的组合下，`*` 等于让浏览器拒掉所有带凭据的
 * 跨源响应（开发下表现为「登录态跨源请求拿不到响应」，线上则是静默失效）。
 *
 * 因此这里保留 `credentials: true`（本项目 cookie 认证必需），但把「origin 必须是
 * 具体源」当作不变量：一旦有人通过 env 把 allowOrigin 改回 `*`，启动时 warn 一次。
 */
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

    // 不变量的运行时告警（不是拒绝启动）：通配源 + 凭据在浏览器侧必然失败，
    // 静默下去只会表现为「跨源请求拿不到响应」，排查成本极高。
    if (allowOrigin === '*' || (Array.isArray(allowOrigin) && allowOrigin.includes('*'))) {
      new Logger(CorsMiddleware.name).warn(
        'CORS allowOrigin 含通配 `*`，但 credentials: true —— 浏览器会拒绝带凭据的跨源响应。'
        + ' 请改用显式源（APP_CORS_ALLOW_ORIGINS 逗号分隔）。',
      )
    }

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
