import { Module } from '@nestjs/common'

import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AppSettingEntity } from './entity/setting.entity'
import { AppSettingsRepositoryModule } from './repo/setting.repo.module'
import { AppSettingBasicRepository } from './setting.basic.repository'
import { AppSettingController } from './setting.controller'
import { appSettingRecoverableProvider } from './setting.recoverable'
import { AppSettingService } from './setting.service'

/**
 * B4 迁移（接线形态同 demo.module，B1 确立）：Mongo forFeature 摘除，
 * 换 PG forFeature；跨模块的 AppSettingRepositoryService 由全局的
 * AppSettingsRepositoryModule 继续提供（task / ip 消费方不动）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppSettingEntity], WalnutPGConnectionName),
    AppSettingsRepositoryModule,
  ],
  controllers: [AppSettingController],
  providers: [AppSettingBasicRepository, AppSettingService, appSettingRecoverableProvider],
  exports: [AppSettingService],
})
export class AppSettingsModule {}
