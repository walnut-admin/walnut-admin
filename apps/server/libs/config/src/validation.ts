import { plainToClass } from 'class-transformer'
import { IsNumber, IsString, validateSync } from 'class-validator'

class EnvironmentVariables {
  @IsString()
  APP_API_PREFIX: string

  @IsNumber()
  APP_API_VERSION: number

  @IsNumber()
  APP_PORT: number

  @IsNumber()
  APP_THROTTLE_TTL: number

  @IsNumber()
  APP_THROTTLE_LIMIT: number

  @IsNumber()
  APP_CACHE_TTL: number

  @IsNumber()
  APP_CACHE_MAX: number

  @IsString()
  APP_I18N_FALLBACK: string

  @IsString()
  APP_NAME: string

  @IsString()
  SERVER_NAME: string

  /* redis */
  @IsString()
  APP_REDIS_HOST: string

  @IsNumber()
  APP_REDIS_PORT: number

  @IsString()
  APP_REDIS_PASS: string

  /* mongo database relatives */
  @IsString()
  DATABASE_PRIMARY: string

  @IsString()
  DATABASE_SECONDARY: string

  @IsString()
  DATABASE_ARBITER: string

  @IsString()
  DATABASE_REPLICASET: string

  @IsString()
  DATABASE_NAME: string

  @IsString()
  DATABASE_SOURCE: string

  @IsString()
  DATABASE_USER: string

  @IsString()
  DATABASE_PASS: string

  /* auth github */
  @IsString()
  AUTH_GITHUB_CLIENTID: string

  @IsString()
  AUTH_GITHUB_CLIENTSECRET: string

  @IsString()
  AUTH_GITHUB_CALLBACK: string

  /* auth gitee */
  @IsString()
  AUTH_GITEE_CLIENTID: string

  @IsString()
  AUTH_GITEE_CLIENTSECRET: string

  @IsString()
  AUTH_GITEE_CALLBACK: string

  /* auth google */
  @IsString()
  AUTH_GOOGLE_CLIENTID: string

  /* auth webauthn */
  @IsString()
  AUTH_WEBAUTHN_RPID: string

  @IsString()
  AUTH_WEBAUTHN_ORIGIN: string

  /* jwt secrets */
  @IsString()
  JWT_ACCESS_TOKEN_SECRET: string

  @IsNumber()
  JWT_ACCESS_TOKEN_EXPIRE: number

  @IsString()
  JWT_REFRESH_TOKEN_SECRET: string

  @IsNumber()
  JWT_REFRESH_TOKEN_EXPIRE: number

  /* auth opaque */
  @IsString()
  AUTH_OPAQUE_SECRET: string

  /* mfa encryption key, used for encrypting mfa code, do not change easily */
  @IsString()
  MFA_ENCRYPTION_KEY: string

  /* refresh token encryption key, used for encrypting refresh token, do not change easily */
  @IsString()
  RT_ENCRYPTION_KEY: string

  /* device id encryption key, used for encrypting device id, do not change easily */
  @IsString()
  DEVICE_ID_ENCRYPTION_KEY: string

  /* user identity encryption key, used for encrypting user identity, do not change easily */
  @IsString()
  USER_ID_ENCRYPTION_KEY: string

  /* user identity hash salt, used for hashing user identity, do not change easily */
  @IsString()
  USER_ID_HASH_SALT: string

  /* socket config */
  @IsNumber()
  SOCKET_SERVER_PORT: number

  @IsString()
  SOCKET_SERVER_PATH: string

  @IsString()
  SOCKET_SERVER_ORIGIN: string

  /* baidu ak */
  @IsString()
  VENDOR_KEYS_BAIDU: string

  /* email */
  @IsString()
  EMAIL_HOST: string

  @IsNumber()
  EMAIL_PORT: number

  @IsString()
  EMAIL_AUTH_USER: string

  @IsString()
  EMAIL_AUTH_PASS: string

  @IsString()
  EMAIL_FROM_ADDRESS: string

  @IsString()
  EMAIL_FROM_NAME: string

  /* ali oss */
  @IsString()
  VENDOR_KEYS_ALI_OSS_REGION: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_BUCKET: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_ID: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_SECRET: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_ENDPOINT: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_ROLE_ARN: string

  @IsString()
  VENDOR_KEYS_ALI_OSS_ROLE_SESSION_NAME: string

  /* tencent sms */
  @IsString()
  VENDOR_KEYS_TX_SMS_REGION: string

  @IsString()
  VENDOR_KEYS_TX_SMS_ID: string

  @IsString()
  VENDOR_KEYS_TX_SMS_SECRET: string

  @IsString()
  VENDOR_KEYS_TX_SMS_ENDPOINT: string

  @IsString()
  VENDOR_KEYS_TX_SMS_SDK_APP_ID: string

  @IsString()
  VENDOR_KEYS_TX_SMS_SIGN_NAME: string

  @IsString()
  VENDOR_KEYS_TX_SMS_TEMPLATE_ID: string
}

export function validateConfig(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  })

  if (errors.length > 0) {
    throw new Error(errors.toString())
  }

  return validatedConfig
}
