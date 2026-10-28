import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'

import { I18nMiddleware } from 'nestjs-i18n'

import { BlacklistPathMiddleware } from './src/blacklist-path.middleware'
import { CompressionMiddleware } from './src/compression.middleware'
import { CookieParserMiddleware } from './src/cookieParser.middleware'
import { CorsMiddleware } from './src/cors.middleware'
import { CSPMiddleware } from './src/csp.middleware'
import { FaviconMiddleware } from './src/favicon.middleware'
import { FingerprintMiddleware } from './src/fingerprint.middleware'
import { HelmetMiddleware } from './src/helmet.middleware'
import { IdMiddleware } from './src/id.middleware'
import { IpMiddleware } from './src/ip.middleware'
import { LanguageMiddleware } from './src/language.middleware'
import { LoggerMiddleware } from './src/logger.middleware'
import { ResponseTimeMiddleware } from './src/responseTime.middleware'
import { SessionMiddleware } from './src/session.middleware'
import { TimezoneMiddleware } from './src/timezone.middleware'
import { UserAgentMiddleware } from './src/user-agent.middleware'
import { VersionMiddleware } from './src/version.middleware'
import { XSSMiddleware } from './src/xss.middleware'

@Module({})
export class AppMiddlewareModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        FaviconMiddleware,
        I18nMiddleware,

        IdMiddleware,
        VersionMiddleware,
        TimezoneMiddleware,
        LanguageMiddleware,

        IpMiddleware,
        UserAgentMiddleware,
        // P1-11：未命中路由的请求不执行 guard 链 —— 黑名单路径检查落在中间件
        // （依赖 IpMiddleware 的 realIp 与 UserAgentMiddleware 的 isPostman）
        BlacklistPathMiddleware,

        XSSMiddleware,
        CSPMiddleware,

        SessionMiddleware,
        CookieParserMiddleware,

        FingerprintMiddleware,

        CorsMiddleware,
        CompressionMiddleware,
        HelmetMiddleware,

        ResponseTimeMiddleware,

        LoggerMiddleware,
      )
      .forRoutes('*')
  }
}
