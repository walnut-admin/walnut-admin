import { join } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isDev } from '@walnut-server/config/utils/env'
import { RequestHeaders } from '@walnut/contract/http'

import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nJsonLoader,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n'

@Module({
  imports: [
    I18nModule.forRootAsync({
      // nestjs-i18n 的 I18nAsyncOptions 继承 Pick<ModuleMetadata, 'imports'>，
      // Nest 12 下该别名解析退化后 imports 变必填 —— 显式给空数组
      imports: [],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        fallbackLanguage: configService.get('app.i18n.fallback') as string,
        loaderOptions: {
          path: join(__dirname, '../i18n/'),
          watch: true,
        },
        logging: isDev,
      }),

      resolvers: [
        new HeaderResolver([
          RequestHeaders.LANGUAGE,
          RequestHeaders.LANGUAGE.toLowerCase(),
        ]),
        new QueryResolver(['xl']),
        new AcceptLanguageResolver(),
      ],
      loader: I18nJsonLoader,
    }),
  ],
  providers: [],
  exports: [],
})
export class AppI18nModule {}
