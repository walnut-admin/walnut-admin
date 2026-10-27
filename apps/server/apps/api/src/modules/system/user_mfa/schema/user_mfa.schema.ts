import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { IWalnutAdminConstSysUserMfaType, IWalnutAdminConstSysUserMfaWebauthnTransport, WalnutAdminConstSysUserMfaType, WalnutAdminConstSysUserMfaWebauthnTransport } from '../mfa.const'

export class SysUserMfaModel extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserMfaType, {
    swaggerOptions: {
      title: 'mfa device type',
    },
  })
  type: IWalnutAdminConstSysUserMfaType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id',
    },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'mfa device name',
    },
  })
  name: string

  // TOTP专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'totp secret ciphertext',
    },
  })
  totpSecretCiphertext: string

  // WebAuthn专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'webauthn credential id',
    },
  })
  webauthnCredentialId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'webauthn public key',
    },
  })
  webauthnPublicKey: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'webauthn counter',
    },
  })
  webauthnCounter: number

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserMfaWebauthnTransport, {
    isArray: true,
    swaggerOptions: {
      title: 'webauthn transports',
    },
  })
  webauthnTransports: IWalnutAdminConstSysUserMfaWebauthnTransport[]

  // SMS专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'phone number ciphertext',
    },
  })
  phoneNumberCiphertext: string

  // 备用码专�?
  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'backup codes ciphertext',
    },
  })
  backupCodesCiphertext: string[]

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'status',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'last used at',
    },
  })
  lastUsedAt: Date
}
