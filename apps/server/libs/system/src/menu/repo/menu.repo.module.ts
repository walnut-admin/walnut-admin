import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysMenuEntity } from '../entity/menu.entity'
import { SysMenuRepositoryService } from './menu.repo.service'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 *
 * D10（批次 5）：**不再是 @Global** —— 注入 `SysMenuRepositoryService` 的类只声明在
 * `SysMenuSharedModule` 一个模块里（判据「消费方模块 ≥ 2」不成立）。该模块已显式
 * import 本模块。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysMenuEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysMenuRepositoryService],
  exports: [SysMenuRepositoryService],
})
export class SysMenuRepositoryModule { }
