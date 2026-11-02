import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ThrottlerModuleOptions,
  ThrottlerOptionsFactory,
} from '@nestjs/throttler'

@Injectable()
export class ThrottlerConfigService implements ThrottlerOptionsFactory {
  private readonly logger = new Logger('ConfigService - Throttler')

  constructor(private readonly configService: ConfigService) {}

  createThrottlerOptions(): ThrottlerModuleOptions {
    this.logger.log('[ThrottlerLog] Initiating throttler module...')

    return [
      {
        ttl: Number(this.configService.get<number>('app.throttle.ttl')) * 1000,
        limit: Number(this.configService.get<number>('app.throttle.limit')),
      },
    ]
  }
}
