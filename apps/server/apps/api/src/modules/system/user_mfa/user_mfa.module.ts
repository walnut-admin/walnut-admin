import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AuthMfaModule } from '@/modules/auth/modules/mfa/mfa.module'
import { SysUserSharedModule } from '../user/shared/user.shared.module'
import { SysUserMfaEntity } from './entity/user-mfa.entity'
import { SysUserMfaHelperService } from './mfa.shared.service'
import { SysUserMfaTotpController } from './totp/totp.controller'
import { SysUserMfaTotpService } from './totp/totp.service'
import { SysUserMfaWebauthnController } from './webauthn/webauthn.controller'
import { SysUserMfaWebauthnService } from './webauthn/webauthn.service'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserMfaEntity], WalnutPGConnectionName),
    SysUserSharedModule,
    AuthMfaModule,
  ],
  controllers: [SysUserMfaTotpController, SysUserMfaWebauthnController],
  providers: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
  exports: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
})
export class SysUserMfaModule {}
