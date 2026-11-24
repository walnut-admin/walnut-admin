/**
 * `pnpm db:seed --admin <userName> --password <pw>` —— **在本机**给某个账号建立口令凭证。
 *
 * ## 为什么不能随仓库发一份口令
 *
 * OPAQUE 的服务端 `serverSetup` **就是 `AUTH_OPAQUE_SECRET`**（见
 * `opaque.core.service.ts` 里 `this.serverSetup = configService.get('jwt.opaque.secret')`），
 * 而客户端产出的注册记录（registration record）是用 OPRF 输出派生的密钥加密的 ⇒ **换一个 secret
 * 就必然登不进去**。发布它等于发布一份在别人机器上无效的凭证；要让它能用就得连 secret 一起发
 * （它属于 `apps/server/AGENTS.md` 的「环境变量」一节里那组「部署后不许改」的根密钥 ——
 * 判据是「改一次，用旧 key 加密的历史数据就再也解不开」，不是某个固定的条数 ——
 * 共用它就等于所有安装共用同一把根密钥）。
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

/**
 * OPAQUE 的 `server` identifier —— 必须与 UI 登录**逐字一致**。
 *
 * 真源是 `apps/admin/src/store/modules/user/user-auth.ts` 的 `opaqueServerIdentifier`
 * （那行注释是 JUST DO NOT CHANGE THIS）；后端登录链路（`opaque.core.service.ts` /
 * `opaque.user.service.ts`）传的 `app.name` 也是同一个值。
 */
export const OPAQUE_SERVER_IDENTIFIER = 'walnut-admin'

/**
 * 构造 OPAQUE 的 identifiers —— 注册与登录共用这一个出口。
 *
 * `@serenity-kit/opaque` 的契约：只要在 `client.finishRegistration` 里提供了 identifiers，
 * 登录侧（`server.startLogin` / `client.finishLogin`）就必须提供**完全相同**的一份，
 * 否则 `client.finishLogin` 直接返回 undefined（口令是对的也登不进去）。
 */
export function buildOpaqueIdentifiers(userName: string): { client: string, server: string } {
  return { client: userName, server: OPAQUE_SERVER_IDENTIFIER }
}

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
  // identifiers 必须与 UI 登录（`user-auth.ts` 的 AuthWithOpaque）逐字一致，否则 --admin 造出的
  // 口令登不进 UI（2026-11-24 复核发现：注册时不带 identifiers、登录时带，client.finishLogin
  // 会直接返回 undefined）。注意这只修**新生成**的凭证：已经存在的旧凭证行仍绑着旧口径，
  // 要让旧演示账号可用，需要在目标环境重跑一次 --admin。
  const { registrationRecord } = client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: buildOpaqueIdentifiers(userName),
  })

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
    // 与线上登录同一条链路：客户端起手 → 服务端起手 → 客户端收尾 → 服务端收尾（拿到会话密钥）。
    // identifiers 与注册时同源：注册提供了什么，登录就必须原样提供（见 buildOpaqueIdentifiers）。
    const identifiers = buildOpaqueIdentifiers(userName)
    const { clientLoginState, startLoginRequest } = client.startLogin({ password })
    const { serverLoginState, loginResponse } = server.startLogin({
      serverSetup,
      userIdentifier: userName,
      registrationRecord,
      startLoginRequest,
      identifiers,
    })
    const clientFinish = client.finishLogin({ clientLoginState, loginResponse, password, identifiers })
    if (clientFinish === undefined)
      return { ok: false, reason: '客户端收尾返回 undefined（口令或注册记录不匹配）' }
    const serverFinish = server.finishLogin({ serverLoginState, finishLoginRequest: clientFinish.finishLoginRequest })
    return { ok: serverFinish.sessionKey.length > 0, sessionKeyLength: serverFinish.sessionKey.length }
  }
  catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
