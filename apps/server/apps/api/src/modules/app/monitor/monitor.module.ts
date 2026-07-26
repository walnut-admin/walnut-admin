import { Module } from '@nestjs/common'

import { AppMonitorCacheModule } from './cache/cache.module'
import { AppMonitorServerModule } from './server/server.module'
import { AppMonitorUserModule } from './user/user.module'

@Module({
  imports: [
    AppMonitorCacheModule,
    AppMonitorUserModule,
    AppMonitorServerModule,
  ],
})
export class AppMonitorModule {}
