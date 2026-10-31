import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_ERROR_REPORTER } from '@walnut-server/exceptions'
import { WalnutAdminFilterExceptionAll } from '@walnut-server/exceptions/exception.filter'
import { AppErrorEntity } from './entity/error.entity'
import { AppErrorBasicRepository } from './error.basic.repository'
import { AppErrorController } from './error.controller'
import { AppErrorProcessor } from './error.process'
import { appErrorRecoverableProvider } from './error.recoverable'
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
  providers: [AppErrorBasicRepository, AppErrorService, AppErrorProcessor,
    // 异常过滤器的错误入库端口绑定（libs 解耦批 1 的依赖反转：filter 在 lib 里，
    // 错误入库在 app 里，经 WALNUT_ADMIN_ERROR_REPORTER 端口连接）
    {
      provide: WALNUT_ADMIN_ERROR_REPORTER,
      useExisting: AppErrorService,
    }, {
      provide: APP_FILTER,
      useClass: WalnutAdminFilterExceptionAll,
    }, appErrorRecoverableProvider],
  exports: [AppErrorService],
})
export class AppErrorModule {}
