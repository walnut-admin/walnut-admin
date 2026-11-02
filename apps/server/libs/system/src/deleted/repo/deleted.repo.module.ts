import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeletedEntity, WALNUT_ADMIN_SOFT_DELETE_STRATEGY, WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { SysDeletedPgRepoService } from './deleted.repo.pg.service'

/**
 * @Global 回收站通道：PG 软删仓库（libs/repository 基类的 deleteSoftById 依赖）+
 * 恢复器注册表（modelName → 恢复器，批 7 登记制）。Mongo 版 SysDeletedRepoService
 * 及其 forFeature 已随 B9 双轨收口下线。
 *
 * 批 5：基类仓库下沉 libs 后只认 `WALNUT_ADMIN_SOFT_DELETE_STRATEGY` 端口，这里把
 * 本仓库服务绑上去（`SysDeletedPgRepoService implements ISoftDeleteStrategy` 作编译期
 * 守护）。本模块是 @Global，绑定全局可见；缺绑定 = 启动期 DI 报错（与解耦前等价）。
 *
 * 批 7：恢复器注册表本身不在此装配（没有静态清单）—— 各域在自己的 Nest module 里
 * 通过薄 factory provider 登记（libs/system 各子模块、libs/identity、app 各域）。
 * 本 @Global 模块只提供**注册表实例**，让所有域都能注入同一个 map。
 */
@Global()
@Module({
  imports: [
    // PG 版软删仓库的实体注册（autoLoadEntities 通道）
    TypeOrmModule.forFeature([SysDeletedEntity], WalnutPGConnectionName),
  ],
  providers: [
    SysDeletedPgRepoService,
    WalnutAdminRecoverableRegistry,
    {
      provide: WALNUT_ADMIN_SOFT_DELETE_STRATEGY,
      useExisting: SysDeletedPgRepoService,
    },
  ],
  exports: [SysDeletedPgRepoService, WalnutAdminRecoverableRegistry, WALNUT_ADMIN_SOFT_DELETE_STRATEGY],
})
export class SysDeletedRepoModule {}
