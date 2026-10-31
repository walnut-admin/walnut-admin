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
 * 写方（app 的 decorator / auth 的 otp decorator）与读方（libs/system 的
 * `SysLogAuthSharedService.getAuthLogTypeFromMetadata`）必须拿同一个 Symbol ——
 * 读方在 lib、写方在 app，键只能放更低的 libs/const。app 装饰器 re-export 本符号，
 * 既有 import 面不变。
 */
export const WalnutAdminConstDecoratorLogAuthMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_AUTH')
