import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'

import { AppSettingsRepositoryModule } from './repo/setting.repo.module'
import { AppSettingSchema } from './schema/setting.schema'
import { AppSettingBasicRepository } from './setting.basic.repository'
import { AppSettingController } from './setting.controller'
import { AppSettingService } from './setting.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.APP_SETTING,
          schema: AppSettingSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    AppSettingsRepositoryModule,
  ],
  controllers: [AppSettingController],
  providers: [AppSettingBasicRepository, AppSettingService],
  exports: [AppSettingService],
})
export class AppSettingsModule {}
