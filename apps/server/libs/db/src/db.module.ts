import { Module } from '@nestjs/common'

import { WalnutPGModule } from './pg.module'

/**
 * 数据库装配（Phase 5a 起 PG 单引擎）：只有 `WalnutPGModule` 一条腿。
 * （Mongo 的 `MongooseModule.forRootAsync` 与 `WalnutDBConfigService` 已随摘除下线。）
 */
@Module({
  imports: [
    WalnutPGModule,
  ],
  providers: [],
  exports: [],
})
export class WalnutModule {}
