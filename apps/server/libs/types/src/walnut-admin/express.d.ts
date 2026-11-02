import type { Recordable } from 'easy-fns-ts'
import type { Request, Response } from 'express'
import type { IResult } from 'ua-parser-js'
import type { LocaleType } from '@walnut/contract'
import type { IWalnutAdminDataScopeRlsSettings, WalnutTxContext } from '@walnut-server/db'

declare global {
  namespace Express {
    interface User extends IWalnutAdminAccessTokenPayload { }
  }

  interface IWalnutadminCookie {
    /**
     * @description DO NOT USE req.signedCookies directly, use `getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)` instead
     */
    DEVICE_ID?: string
    /**
     * @description DO NOT USE req.signedCookies directly, use `getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.CAPJS_TOKEN)` instead
     */
    CAPJS_TOKEN?: string
    /**
     * @description DO NOT USE req.signedCookies directly, use `getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.RT_JTI)` instead
     */
    RT_JTI?: string
    /**
     * @description DO NOT USE req.signedCookies directly, use `getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.SIGN_TICKET)` instead
     */
    SIGN_TICKET?: string
  }

  interface IWalnutAdminExpressRequest extends Request {
    /**
     * @description request id
     */
    id: string

    /**
     * @description real ip
     */
    realIp: string

    /**
     * @description fingerprint
     */
    fingerprint: string

    timestamp?: number
    userAgent?: IResult

    // normal context
    isBot: boolean
    isPostman: boolean
    isSuspicious: boolean
    os: string
    browser: string
    engine: string
    timezone: string
    language: LocaleType
    version: string
    repoVersion: string

    /**
     * @description risk context - uses global IWalnutAdminRequestRiskContext
     */
    risk: IWalnutAdminRequestRiskContext

    /**
     * @description 已验签 + 已一次性消费的 OAuth state（P2-13 的 state 通道）。
     *
     * 由 OAuth callback guard（`OAuthGiteeGuard` / `OAuthGitHubGuard`）在换 code 之前挂上；
     * 回调 handler 只从这里取 `lang` / `deviceId` —— 不再二次解析 `state` query、也不回读
     * device cookie，于是「投递频道绑定的设备」与「state 签发时绑定的设备」是同一个值。
     * `deviceId` 已由 `OAuthStateService.consumeState` 与本请求 cookie 做过相等校验。
     *
     * 结构对齐 `@walnut-server/auth` 的 `IWalnutOAuthStateConsumed`：这里内联结构，
     * 避免基建层的纯类型 lib 出现指向领域 lib 的出边。
     */
    oauthState?: {
      lang?: LocaleType
      deviceId: string
    }

    /**
     * @description risk pre auth collected
     */
    _riskPreAuthCollected?: boolean

    /**
     * @description risk post auth collected
     */
    _riskPostAuthCollected?: boolean

    /*
     * @description identifier for auth, e.g. email address, phone number, etc.
     */
    identifier?: string

    /**
     * @description Used with `@WalnutTx` and `@WalnutTxSession` to get the
     * transaction context (PG EntityManager). Populated by WalnutTxInterceptor (tx.interceptor.ts).
     */
    txContext?: WalnutTxContext

    /**
     * @description 数据权限三期（RLS）的事务级设置 —— ALSRequestInterceptor（全局）
     * 按请求计算出模式 / 用户 / 部门天花板后挂到这里；WalnutTxInterceptor 在
     * `startTransaction()` 之后用 `set_config(..., true)` 写进事务，供 RESTRICTIVE
     * 策略 `app.data_scope_*()` 读取。
     */
    dataScopeRls?: IWalnutAdminDataScopeRlsSettings

    /**
     * @description Used with `@WalnutAdminDecoratorDecryptRequest` to get decrypted request body
     * mostly designed for operate log security
     */
    _decryptedBody?: Recordable

    /**
     * @description cookies
     */
    signedCookies: IWalnutadminCookie

    /**
     * @description refresh token payload
     */
    RT: IWalnutAdminRefreshTokenPayload

    /**
     * @description refresh token
     */
    realRefreshToken: string
  }

  interface IWalnutAdminExpressResponse extends Response { }
}

export { }
