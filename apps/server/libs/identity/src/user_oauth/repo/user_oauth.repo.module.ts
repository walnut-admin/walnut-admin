import { Global, Module } from '@nestjs/common'
import { SysUserOAuthRepositoryService } from './user_oauth.repo.service'

/**
 * B7a 迁移：Mongo forFeature 摘除（实体注册在 SysUserOauthModule 的 PG forFeature 里）。
 * 模块保持 @Global —— gitee/github 等 auth 系消费方经它注入 SysUserOAuthRepositoryService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysUserOAuthRepositoryService],
  exports: [SysUserOAuthRepositoryService],
})
export class SysUserOAuthRepositoryModule { }
