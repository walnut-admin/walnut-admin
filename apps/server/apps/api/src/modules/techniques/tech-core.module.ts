import { Module } from '@nestjs/common'

import { AppTechCacheModule, AppTechRedisModule } from '@walnut-server/cache'
import { AppTechCookieModule } from '@walnut-server/cookie'
import { AppTechCryptoModule } from '@walnut-server/crypto'
import { AppTechLockModule } from '@walnut-server/lock'
import { AppTechQueueModule } from '@walnut-server/queue'
import { AppTechSseModule } from '@walnut-server/sse'

import { AppTechEventModule } from './event/event.module'
import { AppTechTaskModule } from './task/task.module'

/**
 * 技术面的**非 HTTP 子集**（worker 用；api 仍走 AppTechModule，一行不动 —— 拍板 D1）。
 *
 * 与 AppTechModule 的差异**恰好两项**，都由 drift 守卫钉住
 * （apps/api/src/common/monorepo/core-module-scope.drift.spec.ts）：
 *
 * - 不含 AppTechHealthModule —— 一个 /health controller，只在有监听时才有意义；
 * - 不含 AppTechThrottlerModule —— ThrottlerModule.forRootAsync + 进程内计数器，
 *   tracker 取 req.realIp（throttler.guard.ts:34-36），worker 没有请求；
 *   它启动时那条 [ThrottlerLog] Initiating throttler module... 也是判据之一。
 *
 * 为什么**不**让 AppTechModule 反过来 import 本模块再补 health/throttler：那会把 health
 * 从 imports 的第 6 位挪到末尾，改动 RouterExplorer 的模块遍历顺序 ⇒ openapi.json 的
 * paths 顺序平白多出一段 diff。两份名单 + 一个子集守卫比「一份名单 + 顺序抖动」便宜。
 */
@Module({
  imports: [
    AppTechCacheModule,
    AppTechRedisModule,
    AppTechCookieModule,
    AppTechCryptoModule,
    AppTechEventModule,
    AppTechLockModule,
    AppTechQueueModule,
    AppTechSseModule,
    AppTechTaskModule,
  ],
})
export class AppTechCoreModule {}
