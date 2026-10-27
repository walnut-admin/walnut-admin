import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { AuthCookieModule } from '@/modules/auth/modules/cookie/cookie.module'
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
    // AuthCookieModule：totp / webauthn verify 轮换 RT 后回种 RT_JTI cookie
    // （revoke-and-insert，2026-10-27 —— 旧 jti 行已撤销，不回种新 jti 会话即断）
    AuthCookieModule,
  ],
  controllers: [SysUserMfaTotpController, SysUserMfaWebauthnController],
  providers: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
  exports: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
})
export class SysUserMfaModule {}
