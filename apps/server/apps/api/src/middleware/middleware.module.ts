import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'

import { I18nMiddleware } from 'nestjs-i18n'

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
