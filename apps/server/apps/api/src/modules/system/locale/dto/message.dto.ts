import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { Locale, LocaleType } from '@walnut/contract'

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
