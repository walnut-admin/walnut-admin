import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { WalnutAdminFilterExceptionAll } from '@walnut/exceptions/exception.filter'
import { AppErrorController } from './error.controller'
import { AppErrorProcessor } from './error.process'
import { AppErrorSchema } from './error.schema'
import { AppErrorService } from './error.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.APP_ERROR,
          schema: AppErrorSchema,
        },
      ],
      WalnutDBConnectionName,
    ),

    BullModule.registerQueue({
      name: WalnutAdminConstAppQueue.ERROR,
    }),
  ],
  controllers: [AppErrorController],
  providers: [
    AppErrorService,
    AppErrorProcessor,
    {
      provide: APP_FILTER,
      useClass: WalnutAdminFilterExceptionAll,
    },
  ],
  exports: [AppErrorService],
})
export class AppErrorModule {}
