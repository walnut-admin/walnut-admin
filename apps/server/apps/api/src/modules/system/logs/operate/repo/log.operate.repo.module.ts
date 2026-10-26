import { Global, Module } from '@nestjs/common'
import { SysLogOperateRepoService } from './log.operate.repo.service'

/**
 * B8 迁移：Mongo forFeature 摘除（实体注册在 SysLogOperateModule 的 PG forFeature 里，
 * B7b refresh.repo 同款形态）。模块保持 @Global —— operate log decorator / service
 * 消费方经它注入 SysLogOperateRepoService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysLogOperateRepoService],
  exports: [SysLogOperateRepoService],
})
export class SysLogOperateRepoModule {}
