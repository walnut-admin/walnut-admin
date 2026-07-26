import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'

import { AuthMfaModule } from '@/modules/auth/modules/mfa/mfa.module'
import { SysUserSharedModule } from '../user/shared/user.shared.module'
import { SysUserMfaHelperService } from './mfa.shared.service'
import { SysUserMfaSchema } from './schema/user_mfa.schema'
import { SysUserMfaTotpController } from './totp/totp.controller'
import { SysUserMfaTotpService } from './totp/totp.service'
import { SysUserMfaWebauthnController } from './webauthn/webauthn.controller'
import { SysUserMfaWebauthnService } from './webauthn/webauthn.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_USER_MFA,
          schema: SysUserMfaSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysUserSharedModule,
    AuthMfaModule,
  ],
  controllers: [SysUserMfaTotpController, SysUserMfaWebauthnController],
  providers: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
  exports: [SysUserMfaTotpService, SysUserMfaWebauthnService, SysUserMfaHelperService],
})
export class SysUserMfaModule {}
