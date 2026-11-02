import { Module } from '@nestjs/common'

import { SysDeletedBasicRepository } from './deleted.basic.repository'
import { SysDeletedService } from './deleted.service'
import { SysDeletedRepoModule } from './repo/deleted.repo.module'

/**
 * B9 起 sys_deleted 单轨 PG：实体经 @Global 的 SysDeletedRepoModule 注册
 * （TypeOrmModule.forFeature，autoLoadEntities 通道），Mongo forFeature 随
 * Mongo 版删除链路下线一并摘除。
 */
@Module({
  imports: [
    SysDeletedRepoModule,
  ],
  controllers: [],
  providers: [SysDeletedBasicRepository, SysDeletedService],
  exports: [SysDeletedService],
})
export class SysDeletedModule {}
