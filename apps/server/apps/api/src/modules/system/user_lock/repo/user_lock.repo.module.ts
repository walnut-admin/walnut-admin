import { Global, Module } from '@nestjs/common'
import { SysUserLockRepositoryService } from './user_lock.repo.service'

/**
 * B7b 迁移：Mongo forFeature 摘除（实体注册在 SysUserLockModule 的 PG forFeature 里）。
 * 模块保持 @Global —— user_device / guard 链消费方经它注入 SysUserLockRepositoryService。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SysUserLockRepositoryService],
  exports: [SysUserLockRepositoryService],
})
export class SysUserLockRepositoryModule {}
