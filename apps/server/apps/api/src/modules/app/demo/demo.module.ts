import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysDeletedModule } from '@walnut-server/system'
import { SysDeletedHttpModule } from '@/modules/system/deleted/deleted-http.module'
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
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName),
    SysDeletedModule,
    // 批 7：回收站 controller 留 app；由本模块引入以保持 Swagger 路径顺序
    SysDeletedHttpModule,
  ],
  controllers: [AppDemoController],
  providers: [AppDemoBasicRepository, AppDemoService, appDemoRecoverableProvider],
  exports: [AppDemoService],
})
export class AppDemoModule {}
