import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_SOFT_DELETE_STRATEGY } from '@walnut-server/repository'
import { SysDeletedEntity } from '../entity/deleted.entity'
import { SysDeletedPgRepoService } from './deleted.repo.pg.service'
import { SysDeletedPgRecoverRegistry } from './recover-registry'

/**
 * @Global 回收站通道：PG 软删仓库（libs/repository 基类的 deleteSoftById 依赖）+
 * 恢复注册表（modelName → 恢复器，B9 装配完成）。Mongo 版 SysDeletedRepoService
 * 及其 forFeature 已随 B9 双轨收口下线。
 *
 * 批 5：基类仓库下沉 libs 后只认 `WALNUT_ADMIN_SOFT_DELETE_STRATEGY` 端口，这里把
 * 本仓库服务绑上去（`SysDeletedPgRepoService implements ISoftDeleteStrategy` 作编译期
 * 守护）。本模块是 @Global，绑定全局可见；缺绑定 = 启动期 DI 报错（与解耦前等价）。
 */
@Global()
@Module({
  imports: [
    // PG 版软删仓库的实体注册（autoLoadEntities 通道）
    TypeOrmModule.forFeature([SysDeletedEntity], WalnutPGConnectionName),
  ],
  providers: [
    SysDeletedPgRepoService,
    SysDeletedPgRecoverRegistry,
    {
      provide: WALNUT_ADMIN_SOFT_DELETE_STRATEGY,
      useExisting: SysDeletedPgRepoService,
    },
  ],
  exports: [SysDeletedPgRepoService, SysDeletedPgRecoverRegistry, WALNUT_ADMIN_SOFT_DELETE_STRATEGY],
})
export class SysDeletedRepoModule {}
