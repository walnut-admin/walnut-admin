import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserLockEntity } from './entity/user-lock.entity'
import { SysUserLockRepositoryModule } from './repo/user_lock.repo.module'
import { SysUserLockSharedModule } from './shared/user_lock.shared.module'
import { SysUserLockService } from './user_lock.service'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserLockEntity], WalnutPGConnectionName),
    SysUserLockRepositoryModule,
    SysUserLockSharedModule,
  ],
  // 批 6：controller 留 app（identity-http.module.ts）
  controllers: [],
  providers: [SysUserLockService],
  exports: [SysUserLockService],
})
export class SysUserLockModule {}
