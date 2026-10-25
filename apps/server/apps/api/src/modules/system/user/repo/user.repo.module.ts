import { Global, Module } from '@nestjs/common'
import { SysUserRepositoryService } from './user.repo.service'

/**
 * B7a 迁移：Mongo forFeature 摘除（实体注册在 SysUserModule 的 PG forFeature 里）。
 * 模块保持 @Global —— auth 系消费方在 7c 归一前经它注入 SysUserRepositoryService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysUserRepositoryService],
  exports: [SysUserRepositoryService],
})
export class SysUserRepositoryModule {}
