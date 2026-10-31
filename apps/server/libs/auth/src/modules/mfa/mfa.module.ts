import { Global, Module } from '@nestjs/common'
import { SysUserDeviceSharedModule, SysUserMfaSharedModule, WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION } from '@walnut-server/identity'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSharedModule } from '../shared/shared.module'
import { AuthMfaPostVerificationService } from './mfa.post.service'
import { AuthMfaService } from './mfa.service'

/**
 * @Global：批 6 起 libs/identity 的 totp / webauthn verify 只认
 * WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION 端口；本模块在 app 组合根绑定实现。
 */
@Global()
@Module({
  imports: [AuthSharedModule, SysUserMfaSharedModule, AuthRefreshSharedModule, SysUserDeviceSharedModule, SysUserMfaSharedModule, AuthCookieModule],
  providers: [
    AuthMfaService,
    AuthMfaPostVerificationService,
    {
      provide: WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION,
      useExisting: AuthMfaPostVerificationService,
    },
  ],
  exports: [AuthMfaService, AuthMfaPostVerificationService, WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION],
})
export class AuthMfaModule {}
