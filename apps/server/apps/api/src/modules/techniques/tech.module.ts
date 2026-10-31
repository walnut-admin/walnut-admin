import { Module } from '@nestjs/common'

import { AppTechCookieModule } from '@walnut-server/cookie'
import { AppTechCryptoModule } from '@walnut-server/crypto'
import { AppTechLockModule } from '@walnut-server/lock'
import { AppTechQueueModule } from '@walnut-server/queue'
import { AppTechSseModule } from '@walnut-server/sse'
import { AppTechCacheModule } from './cache/cache.module'
import { AppTechRedisModule } from './cache/redis/redis.module'
import { AppTechEventModule } from './event/event.module'
import { AppTechHealthModule } from './health/health.module'
import { AppTechTaskModule } from './task/task.module'
import { AppTechThrottlerModule } from './throttle/throttler.module'

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
  providers: [],
})
export class AppTechModule {}
