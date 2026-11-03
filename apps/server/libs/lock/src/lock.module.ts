import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MurLockModule } from 'murlock'
import { WALNUT_ADMIN_LOCK } from './lock.port'
import { MurLockAdapter } from './murlock.adapter'

/**
 * 分布式锁装配（D11 端口化的**唯一** vendor 落点）。
 *
 * - `MurLockModule.forRootAsync`：连接参数走同一份 Redis 配置；
 * - `WALNUT_ADMIN_LOCK` → `MurLockAdapter`：消费方只注入 token（10 处），换实现只改这里；
 * - `@Global`：绑定跟随实现（ADR 0022 Decision 3）—— 消费方分布在 guards / security /
 *   app-domain 三层，逐层 import 本模块会把「谁需要锁」变成一层层装配噪声，
 *   与 cache / token / ip 的端口绑定同口径。
 */
@Global()
@Module({
  imports: [
    MurLockModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redisOptions: { url: `redis://${configService.get('app.redis.host')}:${configService.get('app.redis.port')}`, password: configService.get('app.redis.pass') },
        wait: 100,
        maxAttempts: 50,
        logLevel: 'warn',
        ignoreUnlockFail: false,
        failFastOnRedisError: false,
        blocking: true,
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    MurLockAdapter,
    { provide: WALNUT_ADMIN_LOCK, useExisting: MurLockAdapter },
  ],
  exports: [WALNUT_ADMIN_LOCK],
})
export class AppTechLockModule {}
