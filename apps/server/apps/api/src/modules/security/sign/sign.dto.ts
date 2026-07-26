import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'

export class SecuritySignHandShakeRequestDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'rsa pubkey',
    },
  })
  rsaPubKey: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      description: 'force update client rsa pub key in cache',
    },
  })
  force: boolean
}

export class SecuritySignSessionKeyResponseDTO {
  constructor(partial: Partial<SecuritySignSessionKeyResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'encrypted aes key',
    },
  })
  aesKey: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'hkdf info',
    },
  })
  hkdfInfo: string
}
