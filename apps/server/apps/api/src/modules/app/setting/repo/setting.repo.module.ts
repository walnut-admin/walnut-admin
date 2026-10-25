import { Global, Module } from '@nestjs/common'

import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { AppSettingEntity } from '../entity/setting.entity'
import { AppSettingRepositoryService } from './setting.repo.service'

/**
 * B4 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AppSettingEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [AppSettingRepositoryService],
  exports: [AppSettingRepositoryService],
})
export class AppSettingsRepositoryModule {}
