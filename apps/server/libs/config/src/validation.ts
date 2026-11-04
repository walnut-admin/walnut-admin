import { plainToClass, Transform } from 'class-transformer'
import { IsInt, IsNumber, IsOptional, IsString, Matches, MinLength, validateSync } from 'class-validator'
import { assertWalnutPgAppBootstrapPassword } from './utils/pg-app-password'

/**
 * F-42：密钥类 env 的**最小长度**下限（字符数）。
 *
 * 为什么必须有下限：这 7 个值此前只有 `@IsString()` —— 一个 `"1"` 也能启动成功。
 * 它们全部是密码学根材料（对称签名密钥 / 数据加密根 / OPAQUE serverSetup），长度是
 * 唯一的「常识底线」可机械校验项：太短意味着可暴力枚举、或根本不是随机生成出来的密钥
 * （手敲的短串、占位符）。
 *
 * 口径（32 字符 = 32 字节在常见编码下的保守下限）：
 * - hex 编码的 32 字节 = 64 字符；
 * - base64 编码的 32 字节 = 44 字符（带 padding，去掉 `=` 是 43）；
 * - 取 32 是**下限**而不是目标值 —— 它挡的是「短到不可能是随机密钥」的值，不校验编码形式
 *   （历史值里既有 base64、也有 hex 与 dotenvx 生成的随机串，编码形式不是本仓库能统一的口径）。
 *
 * 不会自伤（2026-11 核对 `apps/server/env-local/`，dev / stage / production 三份）：
 * MFA/RT/DEVICE_ID/USER_ID 四个加密根 = 44 字符（正好 base64(32B)），AUTH_OPAQUE_SECRET =
 * 171 字符（`opaque.server.createSetup()` 的固定长度），stage/prod 的 JWT 两个 secret =
 * 128 字符；**最短的是 dev 的 JWT_REFRESH_TOKEN_SECRET = 38 字符**，仍在 32 之上。
 */
const SECRET_MIN_LENGTH = 32

/** 每条消息都点名变量名 —— 类校验器的通用文案只列属性名，排障时看不出该去改哪个 env */
function SECRET_MIN_LENGTH_MESSAGE(name: string) {
  return `${name} 长度不足：最小 ${SECRET_MIN_LENGTH} 字符（32 字节密钥的 base64/hex 保守下限，见 validation.ts 顶部注释）`
}

export class EnvironmentVariables {
  @IsString()
  APP_API_PREFIX: string

  @IsNumber()
  APP_API_VERSION: number

  @IsNumber()
  APP_PORT: number

  /**
   * 反向代理可信跳数（Express app.set('trust proxy', n)，F-11）。
   *
   * **可选，默认 1** —— 默认值对应 docker 单层 nginx：deploy/docker-compose.yml
   * 只发布 80/443，容器内 nginx 以 $remote_addr **覆写** X-Forwarded-For / X-Real-IP
   * （见 deploy/nginx/conf.d/api.conf:50-57），应用前面恰好一跳代理。
   *
   * 为什么不允许 trust proxy = true：那等于信任任意长度的代理跳，客户端自带
   * X-Forwarded-For 即可伪造 req.ip / req.ips，而 IP 黑名单、限流 tracker、失败登录
   * 拉黑、设备 IP 变更跟踪、风控全部按 IP 维度判定（详见 main.ts 与
   * middleware/src/ip.middleware.ts 的同主题注释）。
   *
   * 多层代理（如 CDN + LB + nginx）时按**真实跳数**填；直连部署（无代理）填 0，
   * 表示一律取 socket 对端地址。取值非整数/负数时 main.ts 回落为默认 1。
   *
   * 为什么显式 `@Transform` 而不是只靠 enableImplicitConversion：隐式转换依赖装饰器
   * 元数据（design:type）—— nest build 的 SWC 配置里开了 decoratorMetadata，但
   * vitest / 其他非 tsc 链路不一定有；缺元数据时 '2' 会停在字符串形态被 IsInt 拒掉
   * （等于启动失败）。显式转换让两条链路行为一致：数字字符串转 number，空串视同未配置
   * （回落上面的默认 1），非数字原样留给 IsInt 报错。
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '')
      return undefined

    const parsed = Number(value)
    // 非有限值原样返回：让 IsInt 把它当「不是整数」拒掉，而不是静默变成 NaN
    return Number.isFinite(parsed) ? parsed : value
  })
  @IsInt()
  APP_TRUST_PROXY_HOPS: number = 1

  /**
   * F-43：CORS 允许源覆盖（逗号分隔，**优先于**内置的 dev 白名单 / prod 单源）。
   *
   * 可选：不配置时按 NODE_ENV 取默认值（dev / stage = 127.0.0.1 与 localhost 的常用端口
   * 白名单，prod = https://www.<config.domain>）—— 见 middleware.config.ts 的
   * resolveAllowOrigin。**不要**在这里写 `*`：全站 cookie 认证 + credentials:true，
   * 通配源会被浏览器直接拒绝。
   */
  @IsOptional()
  @IsString()
  APP_CORS_ALLOW_ORIGINS: string

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
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('JWT_ACCESS_TOKEN_SECRET') })
  JWT_ACCESS_TOKEN_SECRET: string

  @IsNumber()
  JWT_ACCESS_TOKEN_EXPIRE: number

  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('JWT_REFRESH_TOKEN_SECRET') })
  JWT_REFRESH_TOKEN_SECRET: string

  @IsNumber()
  JWT_REFRESH_TOKEN_EXPIRE: number

  /* auth opaque */
  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('AUTH_OPAQUE_SECRET') })
  AUTH_OPAQUE_SECRET: string

  /* mfa encryption key, used for encrypting mfa code, do not change easily */
  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('MFA_ENCRYPTION_KEY') })
  MFA_ENCRYPTION_KEY: string

  /* refresh token encryption key, used for encrypting refresh token, do not change easily */
  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('RT_ENCRYPTION_KEY') })
  RT_ENCRYPTION_KEY: string

  /* 历史指纹盐（B5 起 device_id 由服务端随机签发）：指纹不落库、不参与身份派生 ⇒ 0 个消费者
     —— 没有任何加解密 / 派生 / 身份用途。保留只为「部署后不许改的 5 个 key」这条部署契约，
     不是用途；判据与退役口径见
     apps/docs/src/zh-CN/content/backend/configuration.md 的「部署后绝不能改的 5 个 key」 */
  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('DEVICE_ID_ENCRYPTION_KEY') })
  DEVICE_ID_ENCRYPTION_KEY: string

  /* user identity encryption key, used for encrypting user identity, do not change easily */
  @IsString()
  @MinLength(SECRET_MIN_LENGTH, { message: SECRET_MIN_LENGTH_MESSAGE('USER_ID_ENCRYPTION_KEY') })
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

  /* socket admin ui（F-01）：可选 —— 两者同时配置才挂载 @socket.io/admin-ui
     （fail-closed：不配置 = 不挂载）。生产必配。
     注意：@socket.io/admin-ui 0.5.1 只接受 **bcrypt hash** 作 password（明文会在
     instrument() 时被拒、启动即崩）—— 先定强口令（>= 8 位），再用
     bcryptjs.hash(强口令, 10) 生成 hash 填入 env。 */
  @IsOptional()
  @IsString()
  SOCKET_ADMIN_UI_USER: string

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'SOCKET_ADMIN_UI_PASSWORD 对应的强口令最少 8 位（admin UI 强口令下限）' })
  @Matches(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, {
    message: 'SOCKET_ADMIN_UI_PASSWORD 必须是 bcrypt hash（$2a/$2b/$2y 开头、共 60 位）'
      + '—— 用 bcryptjs.hash(强口令, 10) 生成；明文会被 @socket.io/admin-ui 启动拒绝',
  })
  SOCKET_ADMIN_UI_PASSWORD: string

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

  // L5：dev 引导密码不得上 stage / production（缺失必填之外的第二道防呆）
  assertWalnutPgAppBootstrapPassword(
    typeof config.NODE_ENV === 'string' ? config.NODE_ENV : undefined,
    appPass,
  )

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
