import { IWalnutAdminConstAppLanguage, WalnutAdminConstAppLanguage } from '@walnut/const/app/lang'

import { WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'

export class SysLocaleMessageDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language short',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppLanguage)],
    },
  })
  locale: IWalnutAdminConstAppLanguage
}
