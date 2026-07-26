import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'

import { SysDeletedModule } from '@/modules/system/deleted/deleted.module'
import { AppDemoBasicRepository } from './demo.basic.repository'
import { AppDemoController } from './demo.controller'
import { AppDemoService } from './demo.service'
import { AppDemoSchema } from './schema/demo.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.APP_DEMO, schema: AppDemoSchema }],
      WalnutDBConnectionName,
    ),
    SysDeletedModule,
  ],
  controllers: [AppDemoController],
  providers: [AppDemoBasicRepository, AppDemoService],
  exports: [AppDemoService],
})
export class AppDemoModule {}
