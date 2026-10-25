import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysDeletedModule } from '@/modules/system/deleted/deleted.module'
import { AppDemoBasicRepository } from './demo.basic.repository'
import { AppDemoController } from './demo.controller'
import { AppDemoService } from './demo.service'
import { AppDemoEntity } from './entity/demo.entity'

/**
 * B1 确立的模块接线模板：已迁模块直接在既有 module 的 imports 里加
 * `TypeOrmModule.forFeature([Entity], WalnutPGConnectionName)`（autoLoadEntities 通道
 * 装载实体），**不另建 xxx.pg.module 文件**；该模块的 Mongo forFeature 随迁移摘除
 * （未迁模块的 Mongoose 注册原样保留）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName),
    SysDeletedModule,
  ],
  controllers: [AppDemoController],
  providers: [AppDemoBasicRepository, AppDemoService],
  exports: [AppDemoService],
})
export class AppDemoModule {}
