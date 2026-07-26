import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { AuthRefreshSharedModule } from '@/modules/auth/modules/refresh/shared/refresh.shared.module'
import { AuthSignoutModule } from '@/modules/auth/modules/signout/signout.module'
import { SysDeviceSharedModule } from '@/modules/system/device/shared/device.shared.module'
import { AppMonitorUserRepositoryModule } from './repo/user.repo.module'
import { AppMonitorUserSchema } from './schema/user.schema'
import { AppMonitorUserBasicRepository } from './user.basic.repository'
import { AppMonitorUserController } from './user.controller'
import { AppMonitorUserService } from './user.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.APP_MONITOR_USER,
          schema: AppMonitorUserSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    AuthRefreshSharedModule,
    SysDeviceSharedModule,

    AppMonitorUserRepositoryModule,
    AuthSignoutModule,
  ],
  controllers: [AppMonitorUserController],
  providers: [AppMonitorUserService, AppMonitorUserBasicRepository],
  exports: [AppMonitorUserService],
})
export class AppMonitorUserModule {}
