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

/**
 * 认证日志装饰器的元数据键（libs 解耦批 7 从 app 的 `log.auth.decorator` 移来）。
 *
 * 写方（`@walnut-server/guards` 的 log.auth decorator / auth 的 otp decorator）与
 * 读方（libs/system 的 `SysLogAuthSharedService.getAuthLogTypeFromMetadata`）必须拿
 * 同一个 Symbol —— 键留在更低的 libs/const；guards barrel re-export 本符号，
 * 既有 import 面不变。
 */
export const WalnutAdminConstDecoratorLogAuthMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_AUTH')
