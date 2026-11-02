import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MurLockModule } from 'murlock'

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
})
export class AppTechLockModule {}
