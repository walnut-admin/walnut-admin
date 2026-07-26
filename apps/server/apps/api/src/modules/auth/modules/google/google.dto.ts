import { WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'

export class AuthGoogleDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'google FedCM credential, token',
    },
  })
  credential: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'select by, which should be a solid string `fed_cm`',
    },
  })
  select_by: string
}
