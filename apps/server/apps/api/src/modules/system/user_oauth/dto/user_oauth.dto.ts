import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { Expose } from 'class-transformer'
import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user_oauth.schema.ts 的 SysUserOAuthModel
// 改名 SysUserOAuthDTOBase，WalnutAdminConstSysUserOAuthProvider 及其类型随基座类一并
// 搬入），装饰器与字段本体零改动

export const WalnutAdminConstSysUserOAuthProvider = [
  'google-one-tap',
  'gitee',
  'github',
] as const

export type IWalnutAdminConstSysUserOAuthProvider = ValueOf<
  typeof WalnutAdminConstSysUserOAuthProvider
>

export class SysUserOAuthDTOBase extends WalnutAdminCommonBasicModel {
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

export class SysUserOauthDto extends SysUserOAuthDTOBase {
  constructor(partial: Partial<SysUserOauthDto>) {
    super()
    Object.assign(this, partial)
  }
}
