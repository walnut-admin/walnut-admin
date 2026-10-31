import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

export class IdentitySendDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'credential' },
  })
  identifier: string
}

export class IdentityVerifyDTO extends IdentitySendDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'verify code' },
  })
  verifyCode: string
}
