import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class AuthRefreshTokenModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'refresh token jti',
    },
  })
  jti: string

  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id, refer to device collection',
    },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'hashed refresh token',
    },

  })
  encryptedToken: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'token expiredAt time',
    },
  })
  expiredAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'token revoked',
    },
  })
  revoked: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstRevokeRTType, {
    swaggerOptions: {
      title: 'revoke reason',
    },
  })
  revokeReason: IWalnutAdminConstRevokeRTType
}
