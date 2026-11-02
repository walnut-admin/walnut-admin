import { Module } from '@nestjs/common'
import { AppMonitorCacheController } from './cache.controller'

@Module({
  imports: [],
  controllers: [AppMonitorCacheController],
  providers: [],
  exports: [],
})
export class AppMonitorCacheModule {}
