import { Module } from '@nestjs/common'

import { AppTechCacheModule } from './cache/cache.module'
import { AppTechRedisModule } from './cache/redis/redis.module'
import { AppTechCookieModule } from './cookie/cookie.module'
import { AppTechCryptoModule } from './crypto/crypto.module'
import { AppTechEventModule } from './event/event.module'
import { AppTechHealthModule } from './health/health.module'
import { AppTechLockModule } from './lock/lock.module'
import { AppTechQueueModule } from './queue/queue.module'
import { AppTechSseModule } from './sse/sse.module'
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
