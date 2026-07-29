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
