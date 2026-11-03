import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLocaleEntity } from '../entity/locale.entity'
import { SysLocaleRepoService } from './locale.repo.service'

/**
 * B2 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 *
 * D10（批次 5）：**不再是 @Global** —— 注入 `SysLocaleRepoService` 的类只声明在
 * `SysLocaleModule` 一个模块里（判据「消费方模块 ≥ 2」不成立，见 apps/server/AGENTS.md
 * 的「Repository 与 Shared Service」）。该模块已显式 import 本模块，撤掉 @Global 后
 * 依赖重新可见于 imports 图，而不是靠全局作用域悄悄满足。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLocaleEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysLocaleRepoService],
  exports: [SysLocaleRepoService],
})
export class SysLocaleRepoModule {}
