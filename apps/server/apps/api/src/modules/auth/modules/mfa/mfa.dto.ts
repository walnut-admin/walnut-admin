import { IWalnutAdminConstSysUserMfaType, WalnutAdminConstSysUserMfaType } from '@walnut-server/const/app/mfa'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'

export class AuthMfaVerifyDTO {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      description: 'is trusted device',
    },
  })
  trusted: boolean
}

export class AuthMfaStatusDTO {
  constructor(partial: Partial<AuthMfaStatusDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      description: 'enabled or not',
    },
  })
  enabled: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserMfaType, {
    swaggerOptions: {
      description: 'mfa type',
    },
  })
  type: IWalnutAdminConstSysUserMfaType
}
