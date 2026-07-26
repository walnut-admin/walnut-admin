import {
  BullModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bull'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class BullConfigService implements SharedBullConfigurationFactory {
  private readonly logger = new Logger(BullConfigService.name)

  constructor(private readonly configService: ConfigService) {}

  createSharedConfiguration(): BullModuleOptions {
    this.logger.log('[BullLog] Initiating queue module...')

    return {
      redis: {
        host: this.configService.get('app.redis.host'),
        port: this.configService.get('app.redis.port'),
        password: this.configService.get('app.redis.pass'),
      },
      prefix: 'WALNUT_CACHE_BULL',
    }
  }
}
