import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysDeletedModule } from '@walnut-server/system'
import { AppDemoBasicRepository } from './demo.basic.repository'
import { AppDemoController } from './demo.controller'
import { appDemoRecoverableProvider } from './demo.recoverable'
import { AppDemoService } from './demo.service'
import { AppDemoEntity } from './entity/demo.entity'

/**
 * B1 确立的模块接线模板：已迁模块直接在既有 module 的 imports 里加
 * `TypeOrmModule.forFeature([Entity], WalnutPGConnectionName)`（autoLoadEntities 通道
 * 装载实体），**不另建 xxx.pg.module 文件**；该模块的 Mongo forFeature 随迁移摘除
 * （未迁模块的 Mongoose 注册原样保留）。
 *
 * 批 9：整个 demo 子目录（含 controller / DTO）下沉本 lib —— controller 依赖的
 * guard / decorator 已在 libs/guards、DTO 基座已在 libs/identity，不再有 app 依赖。
 * 回收站 controller（批 7 留 app 的 `SysDeletedHttpModule`）仍由 app 的
 * `AppAppModule` 紧随本模块 import，Swagger 路径顺序（demo → deleted → error）不变。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName),
    SysDeletedModule,
  ],
  controllers: [AppDemoController],
  providers: [AppDemoBasicRepository, AppDemoService, appDemoRecoverableProvider],
  exports: [AppDemoService],
})
export class AppDemoModule {}
