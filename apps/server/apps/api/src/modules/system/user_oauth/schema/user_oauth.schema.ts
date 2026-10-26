import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'

import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export const WalnutAdminConstSysUserOAuthProvider = [
  'google-one-tap',
  'gitee',
  'github',
] as const

export type IWalnutAdminConstSysUserOAuthProvider = ValueOf<
  typeof WalnutAdminConstSysUserOAuthProvider
>

export class SysUserOAuthModel extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserOAuthProvider, {
    swaggerOptions: {
      title: 'oauth provider',
    },
  })
  provider: IWalnutAdminConstSysUserOAuthProvider

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'oauth provider id',
    },
  })
  providerId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'what is it?',
    },
  })
  status: boolean
}
