import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AuthRefreshTokenEntity } from '../entity/refresh-token.entity'
import { AuthRefreshTokenPgPurgeService } from './refresh.pg.purge.service'

/**
 * auth_refresh_token 的 PG 侧装配（实体注册 + purge job）。与 Mongo 侧
 * refresh.repo.module / refresh.shared.module 并存，本批不含任何业务读写路径 ——
 * 刷新令牌的签发 / 校验仍走 Mongo（B 阶段后续批次迁移）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuthRefreshTokenEntity], WalnutPGConnectionName),
  ],
  providers: [AuthRefreshTokenPgPurgeService],
  exports: [AuthRefreshTokenPgPurgeService],
})
export class AuthRefreshTokenPgModule {}
