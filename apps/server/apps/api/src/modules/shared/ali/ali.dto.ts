import { WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'

export class SharedAliOSSDTO {
  constructor(partial?: Partial<SharedAliOSSDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({})
  accessKeyId: string

  @WalnutAdminDecoratorFieldString({})
  accessKeySecret: string

  @WalnutAdminDecoratorFieldString({})
  stsToken: string

  @WalnutAdminDecoratorFieldString({})
  region: string

  @WalnutAdminDecoratorFieldString({})
  bucket: string
}
