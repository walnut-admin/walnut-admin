import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { WalnutAdminGuardThrottler } from '../../../guard/throttler.guard'
import { ThrottlerConfigService } from './throttler.service'

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerConfigService,
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: WalnutAdminGuardThrottler,
    },
  ],
  exports: [],
})
export class AppTechThrottlerModule {}
