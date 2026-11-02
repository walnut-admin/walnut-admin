import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { AppTechCacheModule, AppTechRedisModule } from '@walnut-server/cache'
import { AppTechCookieModule } from '@walnut-server/cookie'
import { AppTechCryptoModule } from '@walnut-server/crypto'
import { WalnutAdminGuardThrottler } from '@walnut-server/guards'
import { AppTechLockModule } from '@walnut-server/lock'
import { AppTechQueueModule } from '@walnut-server/queue'
import { AppTechSseModule } from '@walnut-server/sse'
import { AppTechThrottlerModule } from '@walnut-server/throttle'
import { AppTechEventModule } from './event/event.module'
import { AppTechHealthModule } from './health/health.module'
import { AppTechTaskModule } from './task/task.module'

@Module({
  imports: [
    AppTechCacheModule,
    AppTechRedisModule,
    AppTechCookieModule,
    AppTechCryptoModule,
    AppTechEventModule,
    AppTechHealthModule,
    AppTechLockModule,
    AppTechQueueModule,
    AppTechSseModule,
    AppTechTaskModule,
    AppTechThrottlerModule,
  ],
  providers: [
    // throttle guard 的注册留在 app 侧：guard 类在 @walnut-server/guards（libs），
    // APP_GUARD 的顺序装配属于组合根。ThrottlerModule 是 @Global 的，guard 依赖的
    // options/storage 由 @walnut-server/throttle 注册。
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardThrottler,
    },
  ],
})
export class AppTechModule {}
