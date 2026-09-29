/**
 * `pnpm db:seed --admin <userName> --password <pw>` —— **在本机**给某个账号建立口令凭证。
 *
 * ## 为什么不能随仓库发一份口令
 *
 * OPAQUE 的服务端 `serverSetup` **就是 `AUTH_OPAQUE_SECRET`**（见
 * `opaque.core.service.ts` 里 `this.serverSetup = configService.get('jwt.opaque.secret')`），
 * 而客户端产出的注册记录（registration record）是用 OPRF 输出派生的密钥加密的 ⇒ **换一个 secret
 * 就必然登不进去**。发布它等于发布一份在别人机器上无效的凭证；要让它能用就得连 secret 一起发
 * （那是仓里明写的「部署后不许改的 5 个」之一，等于所有安装共用同一把根密钥）。
 *
 * 所以 seed 只发**无凭证**的账号档案，口令由这条命令在**目标环境**里现生成 —— 走的是与线上
 * 注册完全相同的协议（同一份 `@serenity-kit/opaque`，同一个 `serverSetup`），不是伪造 hash。
 *
 * ## 存储形状与服务端逐字对齐
 *
 * `opaque.core.service.ts` 的 `finishRegister()` 往 `sys_user_identity` 里写的是：
 * `type: 'password'` / `purpose: 'login'` / `value` 与 `valueHash` **都放注册记录本身**
 * （服务端注释：Use registration record itself as hash since it's unique）/ `maskedValue: '********'` /
 * `verified: true`。这里照抄 —— 凭证是**原样存储、不加密**的，所以这条命令不需要碰
 * `USER_ID_ENCRYPTION_KEY` 那套加密。
 *
 * ## 自带一道验证
 *
 * 写完立刻用同一个 `serverSetup` 跑一遍**完整的登录握手**（server.startLogin → client.finishLogin
 * → server.finishLogin）。跑通了才说明「这份凭证在本环境真能用」—— 这正是"播种后能登录"的判据，
 * 也是这条命令与"随便插一条记录"的区别。
 */
import { client, server } from '@serenity-kit/opaque'

/** 口令身份的固定形状（与服务端 `finishRegister` 一致） */
export const PASSWORD_IDENTITY = { type: 'password', purpose: 'login' } as const

export interface PasswordIdentity {
  userId: string
  type: 'password'
  purpose: 'login'
  value: string
  valueHash: string
  maskedValue: string
  verified: boolean
  verifiedAt: Date
  isPrimary: boolean
  status: boolean
  metadata: Record<string, unknown>
}

/**
 * 跑一遍 OPAQUE 注册，产出可入库的口令身份行。
 *
 * `serverSetup` 必须是**本环境**的 `AUTH_OPAQUE_SECRET`（不是随便一个字符串）——
 * 传错了这条记录在本环境登不进去（而下面的验证会当场发现）。
 */
export function buildPasswordIdentity(
  userId: string,
  userName: string,
  password: string,
  serverSetup: string,
  now = new Date(),
): PasswordIdentity {
  const { clientRegistrationState, registrationRequest } = client.startRegistration({ password })
  const { registrationResponse } = server.createRegistrationResponse({ serverSetup, userIdentifier: userName, registrationRequest })
  const { registrationRecord } = client.finishRegistration({ clientRegistrationState, registrationResponse, password })

  return {
    userId,
    ...PASSWORD_IDENTITY,
    value: registrationRecord,
    valueHash: registrationRecord,
    maskedValue: '********',
    verified: true,
    verifiedAt: now,
    isPrimary: true,
    status: true,
    metadata: {},
  }
}

export interface LoginProof {
  ok: boolean
  /** 失败时的原因（握手在哪一步炸的） */
  reason?: string
  /** 成功时会话密钥的长度 —— 只报长度不回显内容，用来证明握手真的走完了 */
  sessionKeyLength?: number
}

/** 用给定的口令与已入库的注册记录跑一遍完整登录握手 —— 验证这份凭证在**本环境**可用 */
export function verifyPasswordIdentity(userName: string, password: string, registrationRecord: string, serverSetup: string): LoginProof {
  try {
    // 与线上登录同一条链路：客户端起手 → 服务端起手 → 客户端收尾 → 服务端收尾（拿到会话密钥）
    const { clientLoginState, startLoginRequest } = client.startLogin({ password })
    const { serverLoginState, loginResponse } = server.startLogin({
      serverSetup,
      userIdentifier: userName,
      registrationRecord,
      startLoginRequest,
    })
    const clientFinish = client.finishLogin({ clientLoginState, loginResponse, password })
    if (clientFinish === undefined)
      return { ok: false, reason: '客户端收尾返回 undefined（口令或注册记录不匹配）' }
    const serverFinish = server.finishLogin({ serverLoginState, finishLoginRequest: clientFinish.finishLoginRequest })
    return { ok: serverFinish.sessionKey.length > 0, sessionKeyLength: serverFinish.sessionKey.length }
  }
  catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
