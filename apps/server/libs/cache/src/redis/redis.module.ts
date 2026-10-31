import { Global, Module } from '@nestjs/common'
import { AppTechRedisService } from './redis.service'

@Global()
@Module({
  providers: [AppTechRedisService],
  exports: [AppTechRedisService],
})
export class AppTechRedisModule {}
