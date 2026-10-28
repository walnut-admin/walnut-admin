import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AppKeyEntity } from './entity/key.entity'
import { AppKeyBasicRepository } from './key.basic.repository'
import { AppKeyController } from './key.controller'
import { AppKeyCurrentGuard } from './key.current.guard'
import { AppKeyService } from './key.service'

/**
 * B4 迁移（接线形态同 demo.module，B1 确立）：Mongo forFeature 摘除，换 PG forFeature；
 * service 原先直持 model，随迁移补 AppKeyBasicRepository（PG）。消费方 security/rsa 与
 * techniques/task 不动（AppKeyModule 的 exports 面不变）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppKeyEntity], WalnutPGConnectionName),
  ],
  controllers: [AppKeyController],
  providers: [AppKeyBasicRepository, AppKeyService, AppKeyCurrentGuard],
  exports: [AppKeyService],
})
export class AppKeyModule {}
