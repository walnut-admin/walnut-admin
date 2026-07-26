import type { Recordable } from 'easy-fns-ts'
import type { Request, Response } from 'express'
import type { ClientSession } from 'mongoose'
import type { IResult } from 'ua-parser-js'
import type { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'

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
    language: IWalnutAdminConstAppLanguage
    version: string
    repoVersion: string

    /**
     * @description risk context - uses global IWalnutAdminRequestRiskContext
     */
    risk: IWalnutAdminRequestRiskContext

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
     * @description Used with `@WalnutDBTransaction` and `@WalnutDBSession` to get mongodb transaction
     */
    mongooseSession?: ClientSession

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
