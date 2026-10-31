import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

export class SecurityCapRedeemRequest {
  constructor(partial?: Partial<SecurityCapRedeemRequest>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'cap token',
    },
  })
  token: string

  solutions: Array<[string, string, number]>
}
