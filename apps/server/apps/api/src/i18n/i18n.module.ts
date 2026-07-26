import { join } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isDev } from '@walnut/config/utils/env'
import { WalnutAdminConstAppHeaders } from '@walnut/const/app/header'

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
          WalnutAdminConstAppHeaders.LANGUAGE,
          WalnutAdminConstAppHeaders.LANGUAGE.toLowerCase(),
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
