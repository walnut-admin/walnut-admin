import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminFilterExceptionAll } from '@walnut-server/exceptions/exception.filter'
import { AppErrorEntity } from './entity/error.entity'
import { AppErrorBasicRepository } from './error.basic.repository'
import { AppErrorController } from './error.controller'
import { AppErrorProcessor } from './error.process'
import { AppErrorService } from './error.service'

/**
 * B1 接线（模板同 demo.module）：PG forFeature 进既有 module，本模块的 Mongo
 * forFeature 随迁移摘除；错误写入改走 AppErrorBasicRepository（PG）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppErrorEntity], WalnutPGConnectionName),

    BullModule.registerQueue({
      name: WalnutAdminConstAppQueue.ERROR,
    }),
  ],
  controllers: [AppErrorController],
  providers: [
    AppErrorBasicRepository,
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
