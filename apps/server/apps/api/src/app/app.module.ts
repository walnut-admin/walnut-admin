import { Logger, Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core'

import { JwtAccessGuard } from '@walnut-server/auth'
import { WalnutConfigModule } from '@walnut-server/config'
import { WalnutContextModule } from '@walnut-server/context'
import { WalnutModule } from '@walnut-server/db'
import { ALSRequestInterceptor, WalnutAdminGuardCap, WalnutAdminGuardDevice, WalnutAdminGuardIP, WalnutAdminGuardLock, WalnutAdminGuardMFA, WalnutAdminGuardRisk, WalnutAdminGuardSecurity, WalnutAdminGuardSign, WalnutAdminInterceptorResponseSuccess } from '@walnut-server/guards'

// F-33（ARCH-07）：组合根的**跨目录** import 一律走 `@/*`（= apps/api/src/*），与
// socket.module.ts 同款 —— 相对路径在这里看不出「这个符号属于哪一层」，目录调整时集体断链。
// 同目录的 `./app.controller` / `./app.service` / `./schedule.composition` 仍用相对路径
// （code-style.md「相对路径只在同一模块内部使用」）。
// worker / cli 的跨 app 相对路径是 ADR 认可的（它们直接复用具名文件，不经别名解析）。
import { AppI18nModule } from '@/i18n/i18n.module'
import { AppMiddlewareModule } from '@/middleware/middleware.module'
import { AppAppModule } from '@/modules/app/app.module'
import { AuthModule } from '@/modules/auth/auth.module'
import { SecurityModule } from '@/modules/security/security.module'
import { SharedModule } from '@/modules/shared/shared.module'
import { SysDeviceKickModule } from '@/modules/system/device/shared/device.kick.module'
import { SystemModule } from '@/modules/system/system.module'
import { AppBootstrapTaskModule } from '@/modules/techniques/task/bootstrap-task.module'
import { AppTechModule } from '@/modules/techniques/tech.module'
import { SocketModule } from '@/socket/socket.module'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AppScheduleModule, isWorkerStandalone } from './schedule.composition'

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

    // 拍板-4：封禁 = 踢下线的端口绑定（@Global；消费方是 libs/system 的 SysDeviceService）。
    // 放在 SystemModule 之前，与 SocketModule 同款：绑定先于消费方注册。
    SysDeviceKickModule,

    AppAppModule,

    SystemModule,

    SharedModule,

    // bootstrap 任务归属（W2-A）：默认归 api；WORKER_STANDALONE=true 时归 worker
    // （apps/worker/src/worker.module.ts 恒加载），与 AppScheduleModule 的 cron
    // 条件注册同一判据。放在 imports 末尾是为了不改变既有模块/路由注册顺序
    // （openapi.json 的 paths 顺序依赖 RouterExplorer 的模块遍历顺序）。
    ...(isWorkerStandalone() ? [] : [AppBootstrapTaskModule]),

    // OpenAPI 组装点要按 guard 元数据批量注入 bearer 声明，用 DiscoveryService 遍历控制器
    // （common/swagger/swagger.document.ts）。该模块只提供 DiscoveryService / MetadataScanner，
    // 不注册任何 controller —— 放在 imports 末尾同样不改变既有路由注册顺序。
    DiscoveryModule,
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
