import { Locale,  LocaleType } from '@walnut/contract'

import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

export class SysLocaleMessageDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language short',
    },
    validateOptions: {
      onlyIn: [...Object.values(Locale)],
    },
  })
  locale: LocaleType
}
