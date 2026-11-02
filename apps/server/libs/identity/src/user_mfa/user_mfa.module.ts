import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysUserSharedModule } from '../user/shared/user.shared.module'
import { SysUserMfaEntity } from './entity/user-mfa.entity'
import { SysUserMfaHelperService } from './mfa.shared.service'
import { SysUserMfaTotpService } from './totp/totp.service'
import { SysUserMfaWebauthnService } from './webauthn/webauthn.service'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserMfaEntity], WalnutPGConnectionName),
    SysUserSharedModule,
  ],
  // 批 6：controller 留 app（identity-http.module.ts）
  controllers: [],
  providers: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
  exports: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
})
export class SysUserMfaModule {}
