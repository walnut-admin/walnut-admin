import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

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

/**
 * `POST /security/sign/aes-key` 响应。`aesKey` 被 `@WalnutAdminDecoratorEncryptResponse`
 * 替换为**握手 RSA 信封字符串**（客户端用本地私钥解密还原明文 AES key）——文档层仍按
 * string 声明，形态由 wire 事实决定（服务端不反序列化信封）。
 */
export class SecuritySignSessionKeyResponseDTO {
  constructor(partial: Partial<SecuritySignSessionKeyResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'encrypted aes key payload string (RSA envelope of the session AES key; decrypt with the client private key from the sign handshake)',
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
