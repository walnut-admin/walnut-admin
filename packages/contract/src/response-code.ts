import type { ValueOf } from 'easy-fns-ts'

export type IWalnutAdminConstAppResponseCode = ValueOf<typeof WalnutAdminConstAppResponseCode>

/**
 * 自定义错误码（遵循HTTP状态码语义）
 * 前三位对应HTTP状态码，后两位为细分类型
 */
export const WalnutAdminConstAppResponseCode = {
  // ========== 2xx Success ==========
  /** 成功 */
  SUCCESS: 20000,

  // ========== 4xx Client Errors ==========
  // ----- 400 Bad Request -----
  /** 请求参数错误 */
  BAD_REQUEST: 40000,

  /** 数据已存在 */
  BAD_REQUEST_DATA_EXISTS: 40001,
  /** 无效的资源ID */
  BAD_REQUEST_INVALID_ID: 40002,

  /** RSA解密失败 */
  BAD_REQUEST_DECRYPT_FAILED: 40011,
  /** RSA公钥未找到 */
  BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND: 40012,

  /* 通用请求参数错误 */
  BAD_REQUEST_DATA_ERROR: 40099,
  /** 自定义错误码预留：40091-40099 */

  // ----- 401 Unauthorized -----
  /** 未认证（通用） */
  UNAUTHORIZED: 40100,
  /** 访问令牌过期 */
  UNAUTHORIZED_ACCESS_TOKEN_EXPIRED: 40101,
  /** 刷新令牌过期 */
  UNAUTHORIZED_REFRESH_TOKEN_EXPIRED: 40102,
  /** 用户名或密码错误 */
  UNAUTHORIZED_INVALID_CREDENTIALS: 40103,
  /** 账号被禁止登录 */
  UNAUTHORIZED_ACCOUNT_BANNED: 40104,
  /** 无访问权限 */
  UNAUTHORIZED_NO_PERMISSION: 40105,
  /** 无角色权限 */
  UNAUTHORIZED_NO_ROLE_PERMISSION: 40106,
  /** OAuth认证失败 */
  UNAUTHORIZED_OAUTH_FAILED: 40107,
  /** 系统已禁止注册 */
  UNAUTHORIZED_SIGNUP_BANNED: 40108,
  /** 检测到重复认证 */
  UNAUTHORIZED_DUPLICATE_AUTH: 40109,
  /** 登出失败 */
  UNAUTHORIZED_SIGNOUT_FAILED: 40110,
  /** 人机验证失败 */
  UNAUTHORIZED_BOT_VERIFY_FAILED: 40111,
  /** 签名无效 */
  UNAUTHORIZED_INVALID_SIGNATURE: 40112,
  /** 签名已过期 */
  UNAUTHORIZED_EXPIRED_SIGNATURE: 40113,
  /** 需要MFA验证 */
  UNAUTHORIZED_MFA_REQUIRED: 40114,
  /** MFA验证失败 */
  UNAUTHORIZED_MFA_VERIFY_FAILED: 40115,
  /** 需要人机交互 */
  UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED: 40116,
  /** 验证码已过期，需刷新 */
  UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED: 40117,
  /** 账号已被锁定 */
  UNAUTHORIZED_ACCOUNT_LOCKED: 40118,
  /** 敏感操作验证失败 */
  UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED: 40119,
  /** 自定义错误码预留：40191-40199 */

  // ----- 403 Forbidden -----
  /** 禁止访问（通用） */
  FORBIDDEN: 40300,
  /** 自定义错误码预留：40391-40399 */

  // ----- 404 Not Found -----
  /** 资源未找到（通用） */
  NOT_FOUND: 40400,
  /** 数据未找到 */
  NOT_FOUND_DATA_NOT_FOUND: 40401,
  /** 路由未找到 */
  NOT_FOUND_ROUTE_NOT_FOUND: 40402,
  /** 自定义错误码预留：40491-40499 */

  // ----- 406 Not Acceptable -----
  /** 请求不可接受（通用） */
  NOT_ACCEPTABLE: 40600,
  /** 操作系统不支持 */
  NOT_ACCEPTABLE_OS_UNSUPPORTED: 40601,
  /** 浏览器不支持 */
  NOT_ACCEPTABLE_BROWSER_UNSUPPORTED: 40602,
  /** IP地址被拒绝 */
  NOT_ACCEPTABLE_IP_BLOCKED: 40603,
  /** User-Agent不支持 */
  NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED: 40604,
  /** 设备不支持 */
  NOT_ACCEPTABLE_DEVICE_UNSUPPORTED: 40605,
  /** 设备已锁定 */
  NOT_ACCEPTABLE_DEVICE_LOCKED: 40606,
  /** 设备已禁用 */
  NOT_ACCEPTABLE_DEVICE_BANNED: 40607,
  /** 检测到机器人 */
  NOT_ACCEPTABLE_BOT_DETECTED: 40608,
  /** 检测到可疑请求 */
  NOT_ACCEPTABLE_SUSPICIOUS_REQUEST: 40609,
  /** 路径被拒绝 */
  NOT_ACCEPTABLE_BLACK_LIST_PATH_DETECTED: 40610,
  /** 风险等级过高 */
  NOT_ACCEPTABLE_RISK_TOO_HIGH: 40666,
  /** 自定义错误码预留：40691-40699 */

  // ----- 408 Request Timeout -----
  // TODO not used yet
  /** 请求超时 */
  REQUEST_TIMEOUT: 40800,
  /** 自定义错误码预留：40891-40899 */

  // ----- 429 Too Many Requests -----
  // TODO not used yet
  /** 请求过于频繁 */
  TOO_MANY_REQUESTS: 42900,
  // TODO not used yet
  /** 接口限流 */
  TOO_MANY_REQUESTS_RATE_LIMITED: 42901,
  /** 自定义错误码预留：42991-42999 */

  // ========== 5xx Server Errors ==========
  // ----- 500 Internal Server Error -----
  /** 服务器内部错误（通用） */
  INTERNAL_SERVER_ERROR: 50000,
  /** 数据库错误 */
  INTERNAL_SERVER_ERROR_DATABASE: 50001,
  // TODO not used yet
  /** 缓存错误 */
  INTERNAL_SERVER_ERROR_CACHE: 50002,
  // TODO not used yet
  /** 消息队列错误 */
  INTERNAL_SERVER_ERROR_MQ: 50003,
  /** 自定义错误码预留：50091-50099 */

  // ----- 503 Service Unavailable -----
  /** 服务不可用（通用） */
  SERVICE_UNAVAILABLE: 50300,
  /** 接口不可用 */
  SERVICE_UNAVAILABLE_ENDPOINT_DOWN: 50301,
  /** 依赖服务不可用 */
  SERVICE_UNAVAILABLE_DEPENDENCY_DOWN: 50302,
  // TODO not used yet
  /** 维护中 */
  SERVICE_UNAVAILABLE_MAINTENANCE: 50303,
  /** 自定义错误码预留：50391-50399 */

  // ----- 504 Gateway Timeout -----
  // TODO not used yet
  /** 网关超时 */
  GATEWAY_TIMEOUT: 50400,
  /** 自定义错误码预留：50491-50499 */

  // ----- 505 HTTP Version Not Supported -----
  // TODO not used yet
  /** HTTP版本不支持 */
  HTTP_VERSION_NOT_SUPPORTED: 50500,
  /** 自定义错误码预留：50591-50599 */
} as const
