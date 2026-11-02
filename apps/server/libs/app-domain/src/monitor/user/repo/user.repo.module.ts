import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY } from '@walnut-server/identity'
import { WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER } from '@walnut-server/system'
import { AppMonitorUserEntity } from '../entity/monitor-user.entity'
import { appMonitorUserRecoverableProvider } from '../monitor-user.recoverable'
import { AppMonitorUserRepositoryService } from './user.repo.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
/**
 * 批 6：WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY 绑定到本仓库服务
 * （libs/identity 的 user_device 只认端口；本模块 @Global 全局可见）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AppMonitorUserEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [AppMonitorUserRepositoryService, {
    provide: WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY,
    useExisting: AppMonitorUserRepositoryService,
  },
  // 批 7：libs/system 的设备详情页只认这个端口
  {
    provide: WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER,
    useExisting: AppMonitorUserRepositoryService,
  }, appMonitorUserRecoverableProvider],
  exports: [AppMonitorUserRepositoryService, WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY, WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER],
})
export class AppMonitorUserRepositoryModule { }
