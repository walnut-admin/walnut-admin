import {
  AuthRoutes,
  SecurityRoutes,
} from '@walnut/contract'

/**
 * 风控降级分级（批次 8 / B2）—— **端点敏感度清单的唯一真源**。
 *
 * ## 为什么需要它
 *
 * 改造前：`risk.guard.ts` 在「未知异常」与「拿不到 deviceId」两种情况下都 `return true`
 * （不写 `request.risk`），`cap.guard.ts` 见 `recommendation === undefined` 也直接放行。
 * 三者叠加 = 「风控服务一挂 / 请求没有 deviceId ⇒ 机器人防护完全不执行」——
 * 那是**不拦**，不是降级拦截。
 *
 * ## 口径（Lead 2026-11 拍板）
 *
 * **按端点敏感度分级，不做全局 fail-close**（本仓没有风控 SLA，全关等于把风控服务变成
 * 全站单点，连首页 / 语言包都要看它脸色）：
 *
 * - `fail-close`：风控不可用 / 无 deviceId ⇒ 受控拒绝（40667）。收口在**凭据面** ——
 *   登录、注册、重置密码、OTP/MFA 校验、签发与刷新凭据、`security/sign/*` 握手。
 * - `fail-open`：维持原行为放行，但把「本次请求风控不可用」写进响应壳的
 *   `meta.riskDegraded`（可观测通道，不只是日志）。
 * - 不在本清单里的路由 = `fail-open`（默认值，不需要登记）。
 *
 * ## 为什么清单覆盖 `/auth/**` 与 `/security/**` 的**每一个**路由
 *
 * 这两个前缀是凭据生态的全部入口。只登记 fail-close 几条的话，「新增一条
 * `/auth/xxx/login` 忘了归类」是静默的（默认 fail-open 会替它兜底）；全量登记
 * + `risk.sensitivity.spec.ts` 的扫描对账 ⇒ 新增端点**必须显式归类**，否则红。
 * 清单外的前缀没有这个约束（默认 fail-open 是既定口径）。
 *
 * ## 维护
 *
 * - 加 / 删 `/auth/**`、`/security/**` 路由 ⇒ 同步本表，否则 `risk.sensitivity.spec.ts` 红
 *   （报错里直接给出缺失的 `METHOD path`）。
 * - 表里的 `path` 是 **openapi.json 形态**（无 `/w/v1` 全局前缀；`:name` 为路径参数段），
 *   运行期由 `resolveWalnutAdminRiskSensitivity` 归一化后匹配。
 * - `walnutCrudDecorators` 之类**复合装饰器**生成的路由（list / read / create ...）扫不到，
 *   它们也不在 `/auth`、`/security` 家族里 —— 本清单不受影响。
 */

/** 端点的风控降级策略 */
export type WalnutAdminRiskSensitivity = 'fail-close' | 'fail-open'

/** 降级原因（写进 `request.riskDegraded` → 响应壳 `meta.riskDegraded`） */
export type WalnutAdminRiskDegradedReason
  = | 'no-device-id'
    | 'risk-evaluation-failed'
    | 'risk-recommendation-missing'

export interface IWalnutAdminRiskRouteSensitivity {
  /** HTTP 谓词（大写）。Nest 的 `@Sse` 是 GET 语义的长连接，按 GET 登记 */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** openapi.json 形态的路径（无全局前缀；`:name` 为路径参数段） */
  path: string
  sensitivity: WalnutAdminRiskSensitivity
  /** 归类理由 —— 评审时唯一需要读的字段 */
  reason: string
}

/**
 * 必须显式归类的路由家族（前缀）。清单外的前缀默认 fail-open，不需要登记。
 * 判据：这里收的是「凭据生态」的全部入口 —— 登录链 / 凭据签发 / 握手 / 加密材料。
 */
export const WALNUT_ADMIN_RISK_SENSITIVITY_FAMILIES = [
  AuthRoutes.BASE,
  '/security',
] as const

/** fail-close 条目的通用理由前缀（表里逐条写更细的原因） */
export const WALNUT_ADMIN_RISK_CREDENTIAL_FACE = '凭据面：风控不可用时拒绝执行，避免机器人防护整体缺席'

export const WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY: readonly IWalnutAdminRiskRouteSensitivity[] = [
  // ─── /auth ────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    // 注意：这不是 auth controller 的路由 —— `AppController` 挂在根路径，
    // `@Get(AuthRoutes.BASE)` 让它的「已认证问候语」演示端点正好落在 `/auth`。
    // 扫描对账会把它算进 `/auth` 家族（判据是路径前缀），所以必须显式归类。
    path: AuthRoutes.BASE,
    sensitivity: 'fail-open',
    reason: '根 controller 的已认证问候语演示端点，路径恰好是 /auth；不签发也不校验凭据',
  },
  {
    method: 'POST',
    path: AuthRoutes.REFRESH,
    sensitivity: 'fail-close',
    reason: '刷新凭据：用 RT 换新 AT/RT，风控缺席等于无限续期',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_USER_LOGIN_START,
    sensitivity: 'fail-close',
    reason: '登录链起点（OPAQUE login/start）',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_USER_LOGIN_FINISH,
    sensitivity: 'fail-close',
    reason: '登录链收口（OPAQUE login/finish）：签发 AT + RT',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_USER_LOGIN_CLIENT_ERROR,
    sensitivity: 'fail-open',
    reason: '只写 auth 日志、恒抛 40103，不签发也不校验凭据',
  },
  {
    method: 'POST',
    path: `${AuthRoutes.OPAQUE_USER}/register/start`,
    sensitivity: 'fail-close',
    reason: '注册（补挂口令）第一腿：产生口令材料',
  },
  {
    method: 'POST',
    path: `${AuthRoutes.OPAQUE_USER}/register/finish`,
    sensitivity: 'fail-close',
    reason: '注册（补挂口令）收口：写入口令身份',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_USER_CHANGE_PASSWORD_START,
    sensitivity: 'fail-close',
    reason: '重置口令第一腿',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_USER_CHANGE_PASSWORD_FINISH,
    sensitivity: 'fail-close',
    reason: '重置口令收口：换掉口令并踢下线',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_START,
    sensitivity: 'fail-close',
    reason: '管理员重置口令第一腿（改的是别人的凭据）',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_FINISH,
    sensitivity: 'fail-close',
    reason: '管理员重置口令收口',
  },
  {
    method: 'POST',
    path: AuthRoutes.OPAQUE_ADMIN_PASSWORD_CLEAR,
    sensitivity: 'fail-close',
    reason: '清空口令（等于把账号口令面归零）',
  },
  {
    method: 'POST',
    path: AuthRoutes.OTP_VERIFY,
    sensitivity: 'fail-close',
    reason: 'OTP 校验：成功后签发 AT + RT',
  },
  {
    method: 'POST',
    path: AuthRoutes.MFA_VERIFY,
    sensitivity: 'fail-close',
    reason: 'MFA 校验：第二因子过了才签发 AT',
  },
  {
    method: 'POST',
    path: AuthRoutes.GOOGLE,
    sensitivity: 'fail-close',
    reason: 'Google 登录：校验 idToken 后签发凭据',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITHUB}/callback`,
    sensitivity: 'fail-close',
    reason: 'OAuth 回调：换 code 后签发 AT（投递走同 controller 的 SSE 通道）',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITEE}/callback`,
    sensitivity: 'fail-close',
    reason: 'OAuth 回调：换 code 后签发 AT',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITHUB}/url`,
    sensitivity: 'fail-open',
    reason: '只拼授权 URL（state 服务端签名且绑定本设备），不签发凭据',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITEE}/url`,
    sensitivity: 'fail-open',
    reason: '同上（gitee）',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITHUB}/sse/:fp`,
    sensitivity: 'fail-open',
    reason: '登录结果投递通道：凭据由 callback 签发，本端点只转发（callback 已 fail-close）',
  },
  {
    method: 'GET',
    path: `${AuthRoutes.OAUTH_GITEE}/sse/:fp`,
    sensitivity: 'fail-open',
    reason: '同上（gitee）',
  },
  {
    method: 'POST',
    path: AuthRoutes.SIGNOUT,
    sensitivity: 'fail-open',
    reason: '登出：风控挂掉时**必须**还能登出（fail-close 会把用户锁在登录态里）',
  },
  {
    method: 'GET',
    path: AuthRoutes.PERMISSIONS,
    sensitivity: 'fail-open',
    reason: '已认证读权限菜单，不签发也不校验凭据',
  },
  {
    method: 'GET',
    path: AuthRoutes.KEYS,
    sensitivity: 'fail-open',
    reason: '已认证取会话密钥材料（需要 AT），不签发凭据',
  },
  {
    method: 'GET',
    path: AuthRoutes.MFA_STATUS,
    sensitivity: 'fail-open',
    reason: '读 MFA 方式/状态（登录页展示用）；校验在 mfa/verify（那条已 fail-close）',
  },
  {
    method: 'POST',
    path: AuthRoutes.OTP_SEND,
    sensitivity: 'fail-open',
    reason: '发码不是「校验」，且有独立 throttle 兜底 —— 建议改 fail-close，见报告「需要 Lead 拍板」',
  },

  // ─── /security ────────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: SecurityRoutes.SIGN_INITIAL,
    sensitivity: 'fail-close',
    reason: '请求签名握手：登记客户端 RSA 公钥（Lead 明示 security/sign/* 一律 fail-close）',
  },
  {
    method: 'POST',
    path: SecurityRoutes.SIGN_AES_KEY,
    sensitivity: 'fail-close',
    reason: '请求签名握手：下发被客户端公钥加密的 aesKey（签名体系的地基）',
  },
  {
    method: 'POST',
    path: SecurityRoutes.CAP_CHALLENGE,
    sensitivity: 'fail-open',
    reason: '人机验证的解法入口：风控挂掉时更需要它可用（fail-close 会让挑战无法发起）',
  },
  {
    method: 'POST',
    path: SecurityRoutes.CAP_REDEEM,
    sensitivity: 'fail-open',
    reason: '同上（提交解）',
  },
  {
    method: 'GET',
    path: SecurityRoutes.RSA_PUBLIC_KEY,
    sensitivity: 'fail-open',
    reason: '公钥读取（公开材料），握手第一步',
  },
  {
    method: 'GET',
    path: `${SecurityRoutes.SENSITIVE}/check`,
    sensitivity: 'fail-open',
    reason: '敏感操作验证状态查询（读），不校验第二因子',
  },
  {
    method: 'POST',
    path: `${SecurityRoutes.SENSITIVE}/verify`,
    sensitivity: 'fail-open',
    reason: '敏感操作第二因子增强（已认证用户），不在 Lead 明示的凭据链里 —— 候选改 fail-close，见报告',
  },
]

/** 全局前缀（`/<APP_API_PREFIX>/v<APP_API_VERSION>`）—— 运行期 request.path 带它，表里不带 */
// 懒惰量词：多段前缀（`api/w/v1`）要能剥，但不能把业务段里的 `/v2` 也当版本前缀
// （`/w/v1/system/x/v2` 只剥 `/w/v1`）。
const VERSIONED_PREFIX = /^(?:\/[^/]+)*?\/v\d+(?=\/|$)/

/**
 * 去掉 URI versioning 的全局前缀：`/w/v1/auth/refresh` → `/auth/refresh`；
 * `/v1/auth/refresh` → `/auth/refresh`；无前缀原样返回。
 *
 * 前缀来自 env（APP_API_PREFIX / APP_API_VERSION，main.ts 的 enableVersioning），不硬编码 ——
 * 部署把前缀写成 `api/w` 也不影响匹配。
 */
export function stripWalnutAdminApiVersionPrefix(path: string): string {
  const matched = VERSIONED_PREFIX.exec(path)

  if (matched === null) {
    return path
  }

  const stripped = path.slice(matched[0].length)

  return stripped === '' ? '/' : stripped
}

/** 路径段拆分；根 `/` 是空段集 */
function pathSegments(path: string): string[] {
  return path === '/' ? [] : path.split('/').filter(Boolean)
}

/** 带参路由 pattern 与具体路径是否匹配（`:name` / `:name(regex)` 都按单段通配） */
function matchesRoutePattern(concrete: string, pattern: string): boolean {
  const concreteSegments = pathSegments(concrete)
  const patternSegments = pathSegments(pattern)

  if (concreteSegments.length !== patternSegments.length) {
    return false
  }

  return patternSegments.every((segment, index) =>
    segment.startsWith(':') ? concreteSegments[index] !== '' : segment === concreteSegments[index],
  )
}

/**
 * 解析一条请求的敏感度。
 *
 * @param method `request.method`（大小写不敏感）
 * @param path `request.path`（**可以带**全局前缀，函数内部归一化）
 * @returns 命中清单的条目；未命中返回 undefined（调用方按默认 fail-open 处理）
 */
export function resolveWalnutAdminRiskSensitivity(
  method: string,
  path: string,
): IWalnutAdminRiskRouteSensitivity | undefined {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = stripWalnutAdminApiVersionPrefix(path)

  return WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY.find(entry =>
    entry.method === normalizedMethod && matchesRoutePattern(normalizedPath, entry.path),
  )
}

/** 是否属于 fail-close 端点（未登记 = false ⇒ fail-open） */
export function isWalnutAdminRiskFailClose(method: string, path: string): boolean {
  return resolveWalnutAdminRiskSensitivity(method, path)?.sensitivity === 'fail-close'
}

/** 表里的 `METHOD path` 键（日志 / 断言的稳定形态） */
export function walnutAdminRiskRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${stripWalnutAdminApiVersionPrefix(path)}`
}
