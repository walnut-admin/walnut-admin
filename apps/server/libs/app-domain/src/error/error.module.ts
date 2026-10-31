import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_ERROR_REPORTER } from '@walnut-server/exceptions'
import { WalnutAdminFilterExceptionAll } from '@walnut-server/exceptions/exception.filter'
import { SharedMaskModule } from '../shared/mask/mask.module'
import { AppErrorEntity } from './entity/error.entity'
import { AppErrorBasicRepository } from './error.basic.repository'
import { AppErrorController } from './error.controller'
import { AppErrorProcessor } from './error.process'
import { appErrorRecoverableProvider } from './error.recoverable'
import { AppErrorService } from './error.service'

/**
 * B1 接线（模板同 demo.module）：PG forFeature 进既有 module，本模块的 Mongo
 * forFeature 随迁移摘除；错误写入改走 AppErrorBasicRepository（PG）。
 *
 * 批 9：本模块整体下沉 libs/app-domain。`APP_FILTER` 的
 * `WalnutAdminFilterExceptionAll` 与 `WALNUT_ADMIN_ERROR_REPORTER` 端口绑定都是
 * 纯 lib 依赖（exceptions / 本模块 service），按「provider 绑定跟着 module 走」
 * 原样搬入；error processor 依赖 libs/queue，同样无 app 依赖。mask 壳
 * （`SharedMaskModule`）随本模块同域下沉，显式 import 保证注入可见。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppErrorEntity], WalnutPGConnectionName),

    BullModule.registerQueue({
      name: WalnutAdminConstAppQueue.ERROR,
    }),

    SharedMaskModule,
  ],
  controllers: [AppErrorController],
  providers: [AppErrorBasicRepository, AppErrorService, AppErrorProcessor,
    // 异常过滤器的错误入库端口绑定（libs 解耦批 1 的依赖反转：filter 在 lib 里，
    // 错误入库实现自批 9 起也在本 lib，仍经 WALNUT_ADMIN_ERROR_REPORTER 端口连接）
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
