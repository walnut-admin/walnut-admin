import { Global, Module } from '@nestjs/common'
import { SysUserMfaRepositoryService } from './user_mfa.repo.service'

/**
 * B7b 迁移：Mongo forFeature 摘除（实体注册在 SysUserMfaModule 的 PG forFeature 里）。
 * 模块保持 @Global —— auth mfa / task cron / user.me 消费方经它注入
 * SysUserMfaRepositoryService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysUserMfaRepositoryService],
  exports: [SysUserMfaRepositoryService],
})
export class SysUserMfaRepositoryModule { }
