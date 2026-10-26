import { IWalnutAdminConstAppSettingType, WalnutAdminConstAppSettingType } from '@walnut-server/const/app/setting'

import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class AppSettingModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting name',
    },
  })
  settingName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting key',
    },
  })
  settingKey: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting value',
    },
  })
  settingValue: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingType, {
    swaggerOptions: {
      title: 'setting type',
    },
  })
  settingType: IWalnutAdminConstAppSettingType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'setting remark',
    },
  })
  remark: string
}
