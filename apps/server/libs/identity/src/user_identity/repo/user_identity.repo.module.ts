import { Global, Module } from '@nestjs/common'

import { SysUserIdentityRepositoryService } from './user_identity.repo.service'

/**
 * B7a 迁移：Mongo forFeature 摘除（实体注册在 SysUserIdentityModule 的 PG forFeature 里）。
 * 模块保持 @Global —— auth 系消费方经它注入 SysUserIdentityRepositoryService。
 */
@Global()
@Module({
  imports: [],
  providers: [SysUserIdentityRepositoryService],
  exports: [SysUserIdentityRepositoryService],
})
export class SysUserIdentityRepositoryModule {}
