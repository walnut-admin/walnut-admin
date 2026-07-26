import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstDecoratorLogAuthType = {
  OPAQUE: 'opaque',

  QR: 'qrcode',

  OTP: 'otp',
  OTP_EMAIL: 'emailAddress',
  OTP_PHONE: 'phoneNumber',

  OAUTH_GITHUB: 'github',
  OAUTH_GITEE: 'gitee',
  OAUTH_GOOGLE_FED_CM: 'googleFedCM',
  // ...
} as const

export type IWalnutAdminConstDecoratorLogAuthType = ValueOf<typeof WalnutAdminConstDecoratorLogAuthType>
