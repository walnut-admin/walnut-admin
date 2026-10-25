import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AuthRefreshSharedModule } from '@/modules/auth/modules/refresh/shared/refresh.shared.module'
import { AuthSignoutModule } from '@/modules/auth/modules/signout/signout.module'
import { SysDeviceSharedModule } from '@/modules/system/device/shared/device.shared.module'
import { AppMonitorUserEntity } from './entity/monitor-user.entity'
import { AppMonitorUserRepositoryModule } from './repo/user.repo.module'
import { AppMonitorUserBasicRepository } from './user.basic.repository'
import { AppMonitorUserController } from './user.controller'
import { AppMonitorUserService } from './user.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppMonitorUserEntity], WalnutPGConnectionName),
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
