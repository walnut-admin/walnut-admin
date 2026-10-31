import { Global, Module } from '@nestjs/common'

import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_BLACKLIST_REPOSITORY } from '@walnut-server/ip'
import { AppSettingEntity } from '../entity/setting.entity'
import { AppSettingRepositoryService } from './setting.repo.service'

/**
 * B4 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 *
 * 批 5：把 `WALNUT_ADMIN_BLACKLIST_REPOSITORY` 绑到本仓库服务（libs/ip 的 SharedIpService
 * 在 lib 模块里只认端口；本模块 @Global，绑定全局可见；`AppSettingRepositoryService
 * implements IWalnutAdminBlacklistRepository` 作编译期守护）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AppSettingEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [
    AppSettingRepositoryService,
    {
      provide: WALNUT_ADMIN_BLACKLIST_REPOSITORY,
      useExisting: AppSettingRepositoryService,
    },
  ],
  exports: [AppSettingRepositoryService, WALNUT_ADMIN_BLACKLIST_REPOSITORY],
})
export class AppSettingsRepositoryModule {}
