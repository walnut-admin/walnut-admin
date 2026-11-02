import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthRefreshSharedModule, AuthSignoutModule } from '@walnut-server/auth'

import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeviceSharedModule } from '@walnut-server/system'
import { AppMonitorUserEntity } from './entity/monitor-user.entity'
import { AppMonitorUserRepositoryModule } from './repo/user.repo.module'
import { AppMonitorUserBasicRepository } from './user.basic.repository'
import { AppMonitorUserService } from './user.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 *
 * 批 9：数据面（service / basic repository / repo service / entity / recoverable）
 * 下沉 libs/app-domain，controller 与 wire DTO 留 app —— `AppMonitorUserDTO` 的
 * virtual user 引 app 的 `SysUserDTOSafe`（swagger schema 注册顺序留 app），
 * 由 app 的 `monitor/user/user-http.module.ts` 声明 controller。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppMonitorUserEntity], WalnutPGConnectionName),
    AuthRefreshSharedModule,
    SysDeviceSharedModule,

    AppMonitorUserRepositoryModule,
    AuthSignoutModule,
  ],
  controllers: [],
  providers: [AppMonitorUserService, AppMonitorUserBasicRepository],
  exports: [AppMonitorUserService],
})
export class AppMonitorUserModule {}
