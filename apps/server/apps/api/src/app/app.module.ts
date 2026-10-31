import { Logger, Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { JwtAccessGuard } from '@walnut-server/auth'
import { WalnutConfigModule } from '@walnut-server/config'
import { WalnutContextModule } from '@walnut-server/context'
import { WalnutModule } from '@walnut-server/db'
import { ALSRequestInterceptor, WalnutAdminGuardCap, WalnutAdminGuardDevice, WalnutAdminGuardIP, WalnutAdminGuardLock, WalnutAdminGuardMFA, WalnutAdminGuardRisk, WalnutAdminGuardSecurity, WalnutAdminGuardSign, WalnutAdminInterceptorResponseSuccess } from '@walnut-server/guards'

import { AppI18nModule } from '../i18n/i18n.module'
import { AppMiddlewareModule } from '../middleware/middleware.module'
import { AppAppModule } from '../modules/app/app.module'
import { AuthModule } from '../modules/auth/auth.module'
import { SecurityModule } from '../modules/security/security.module'
import { SharedModule } from '../modules/shared/shared.module'
import { SystemModule } from '../modules/system/system.module'
import { AppTechModule } from '../modules/techniques/tech.module'
import { SocketModule } from '../socket/socket.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AppScheduleModule } from './schedule.composition'

@Module({
  imports: [
    // Middleware
    AppMiddlewareModule,

    // Config
    WalnutConfigModule,

    // Context (Global ALS context)
    WalnutContextModule,

    // I18n
    AppI18nModule,

    // Database
    WalnutModule,

    // Cron 归属：默认在此注册 ScheduleModule；WORKER_STANDALONE=true 时让位给独立 worker
    AppScheduleModule,

    AppTechModule,

    SocketModule,

    AuthModule,

    SecurityModule,

    AppAppModule,

    SystemModule,

    SharedModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    Logger,

    // order: top to bottom, different when used in controller decorator which is bottom to top
    // some endpoint has device/capToken free decorator, so cannot remove to middleware
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardIP,
    },
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardSecurity,
    },
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardDevice,
    },

    // risk guard (pre-auth)
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardRisk,
    },
    // cap guard (pre-auth)
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardCap,
    },

    // jwt guard
    {
      provide: APP_GUARD,
      useClass: JwtAccessGuard,
    },
    // risk guard (post-auth)
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardRisk,
    },
    // cap guard (post-auth)
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardCap,
    },

    // mfa guard
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardMFA,
    },

    // sign guard, must be after jwt guard cause sign is different after user logged in
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardSign,
    },

    // lock guard need to execute after jwt access guard
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardLock,
    },

    // success interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: WalnutAdminInterceptorResponseSuccess,
    },
    // ALS request interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: ALSRequestInterceptor,
    },
  ],
})
export class AppModule {}
