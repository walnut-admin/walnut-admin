import { Global, Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { AppSettingSchema } from '../schema/setting.schema'
import { AppSettingRepositoryService } from './setting.repo.service'

@Global()
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
  ],
  controllers: [],
  providers: [AppSettingRepositoryService],
  exports: [AppSettingRepositoryService],
})
export class AppSettingsRepositoryModule {}
