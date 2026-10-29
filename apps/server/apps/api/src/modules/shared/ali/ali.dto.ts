import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

/**
 * `GET /shared/ali/sts` 响应。三个敏感字段（accessKeyId / accessKeySecret / stsToken）
 * 经 `@WalnutAdminDecoratorEncryptResponse` 替换为**握手 RSA 信封字符串**（客户端私钥
 * 解密还原明文）；region / bucket 明文。
 */
export class SharedAliOSSDTO {
  constructor(partial?: Partial<SharedAliOSSDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'RSA envelope payload string of the STS access key id (decrypt with the client private key)',
    },
  })
  accessKeyId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'RSA envelope payload string of the STS access key secret (decrypt with the client private key)',
    },
  })
  accessKeySecret: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      description: 'RSA envelope payload string of the STS session token (decrypt with the client private key)',
    },
  })
  stsToken: string

  @WalnutAdminDecoratorFieldString({})
  region: string

  @WalnutAdminDecoratorFieldString({})
  bucket: string
}
