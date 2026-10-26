import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeletedEntity } from '../entity/deleted.entity'
import { SysDeletedPgRepoService } from './deleted.repo.pg.service'
import { SysDeletedPgRecoverRegistry } from './recover-registry'

/**
 * @Global 回收站通道：PG 软删仓库（pg-base.repository 的 deleteSoftById 依赖）+
 * 恢复注册表（modelName → 恢复器，B9 装配完成）。Mongo 版 SysDeletedRepoService
 * 及其 forFeature 已随 B9 双轨收口下线。
 */
@Global()
@Module({
  imports: [
    // PG 版软删仓库的实体注册（autoLoadEntities 通道）
    TypeOrmModule.forFeature([SysDeletedEntity], WalnutPGConnectionName),
  ],
  providers: [SysDeletedPgRepoService, SysDeletedPgRecoverRegistry],
  exports: [SysDeletedPgRepoService, SysDeletedPgRecoverRegistry],
})
export class SysDeletedRepoModule {}
