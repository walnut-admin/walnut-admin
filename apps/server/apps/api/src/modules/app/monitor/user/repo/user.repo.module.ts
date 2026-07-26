import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { AppMonitorUserSchema } from '../schema/user.schema'
import { AppMonitorUserRepositoryService } from './user.repo.service'

@Global()
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
  ],
  controllers: [],
  providers: [AppMonitorUserRepositoryService],
  exports: [AppMonitorUserRepositoryService],
})
export class AppMonitorUserRepositoryModule { }
