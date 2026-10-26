import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class SharedAreaModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'unique area code, length 1/2/4/6/9',
    },
  })
  code: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'area name',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'parent area code',
    },
  })
  pcode: string
}
