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
  APP_COOKIE_SECRET: string

  @IsString()
  APP_SESSION_SECRET: string

  @IsString()
  APP_NAME: string

  /* redis */
  @IsString()
  APP_REDIS_HOST: string

  @IsNumber()
  APP_REDIS_PORT: number

  @IsString()
  APP_REDIS_PASS: string

  /* postgres database relatives */
  @IsString()
  DATABASE_PG_HOST: string

  @IsNumber()
  DATABASE_PG_PORT: number

  @IsString()
  DATABASE_PG_USER: string

  @IsString()
  DATABASE_PG_PASS: string

  @IsString()
  DATABASE_PG_NAME: string

  /**
   * 数据权限三期：运行时连接角色（NOSUPERUSER NOBYPASSRLS，受 RLS 约束）。
   * **显式必填**（不允许回退管理角色 —— 回退会让 RLS 静默失效）。缺失时
   * `validateConfig` 会给出指向 `pnpm setup-env` 与迁移的明确报错。
   */
  @IsString()
  DATABASE_PG_APP_USER: string

  @IsString()
  DATABASE_PG_APP_PASS: string

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
  // 数据权限三期：运行时角色必须显式配置 —— 回退管理角色会让 RLS 静默失效。
  // 提前给出可执行的报错（类校验器的通用文案只列字段名，不指向修复步骤）。
  const appUser = config.DATABASE_PG_APP_USER
  const appPass = config.DATABASE_PG_APP_PASS

  if (typeof appUser !== 'string' || appUser === '' || typeof appPass !== 'string' || appPass === '') {
    throw new Error(
      '[config] 缺少 DATABASE_PG_APP_USER / DATABASE_PG_APP_PASS（数据权限三期 RLS 运行时角色）。'
      + '请先执行 `pnpm setup-env` 解密 env-local；确认迁移 1793360000000-DataScopePhase3Rls '
      + '已创建 walnut_app 角色，或按部署文档预建该角色并配置强密码。',
    )
  }

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
