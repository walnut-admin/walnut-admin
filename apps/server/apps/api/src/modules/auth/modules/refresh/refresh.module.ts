import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshTokenEntity } from './entity/refresh-token.entity'
import { AuthRefreshController } from './refresh.controller'
import { authRefreshTokenRecoverableProvider } from './refresh.recoverable'
import { JwtRefreshTokenStrategy } from './refresh.strategy'
import { AuthRefreshTokenPgPurgeService } from './repo/refresh.pg.purge.service'
import { AuthRefreshRepositoryModule } from './repo/refresh.repo.module'
import { AuthRefreshSharedModule } from './shared/refresh.shared.module'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 * B0 的过渡文件 refresh.pg.module（当时只挂实体注册 + purge job，无业务读写）随本批
 * 归一进本模块 —— purge job 的 provider 由此提供，task.module 不再单独引 pg.module。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AuthRefreshTokenEntity], WalnutPGConnectionName),
    AuthRefreshSharedModule,
    AuthRefreshRepositoryModule,
    AuthCookieModule,
  ],
  controllers: [AuthRefreshController],
  providers: [JwtRefreshTokenStrategy, AuthRefreshTokenPgPurgeService, authRefreshTokenRecoverableProvider],
  exports: [AuthRefreshTokenPgPurgeService],
})
export class AuthRefreshModule { }
