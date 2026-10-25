import { Global, Module } from '@nestjs/common'
import { AuthRefreshRepositoryService } from './refresh.repo.service'

/**
 * B7b 迁移：Mongo forFeature 摘除（实体注册在 AuthRefreshModule 的 PG forFeature 里）。
 * 模块保持 @Global —— auth shared / signout / monitor / task 消费方经它注入
 * AuthRefreshRepositoryService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [AuthRefreshRepositoryService],
  exports: [AuthRefreshRepositoryService],
})
export class AuthRefreshRepositoryModule { }
