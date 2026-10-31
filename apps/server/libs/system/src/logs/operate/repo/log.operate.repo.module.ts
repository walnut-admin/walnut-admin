import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_OPERATE_LOG_WRITER } from '@walnut-server/crud'
import { SysLogOperateRepoService } from './log.operate.repo.service'

/**
 * B8 迁移：Mongo forFeature 摘除（实体注册在 SysLogOperateModule 的 PG forFeature 里，
 * B7b refresh.repo 同款形态）。模块保持 @Global —— operate log decorator / service
 * 消费方经它注入 SysLogOperateRepoService。
 *
 * 批 4：操作日志拦截器随 libs/crud 下沉后只认端口，这里把
 * WALNUT_ADMIN_OPERATE_LOG_WRITER 绑到本仓库服务（`implements` 作编译期守护）。
 */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    SysLogOperateRepoService,
    {
      provide: WALNUT_ADMIN_OPERATE_LOG_WRITER,
      useExisting: SysLogOperateRepoService,
    },
  ],
  exports: [SysLogOperateRepoService, WALNUT_ADMIN_OPERATE_LOG_WRITER],
})
export class SysLogOperateRepoModule {}
