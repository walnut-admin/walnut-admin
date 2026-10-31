import { Global, Module } from '@nestjs/common'
import { SysLogAuthRepoService } from './log.auth.repo.service'

/**
 * B8 迁移：Mongo forFeature 摘除（实体注册在 SysLogAuthModule 的 PG forFeature 里，
 * B7b refresh.repo 同款形态）。模块保持 @Global —— auth log decorator / shared service
 * / auth guard 消费方经它注入 SysLogAuthRepoService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysLogAuthRepoService],
  exports: [SysLogAuthRepoService],
})
export class SysLogAuthRepoModule {}
