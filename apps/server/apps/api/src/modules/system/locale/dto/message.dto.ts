import { IWalnutAdminConstAppLanguage, WalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'

import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

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
