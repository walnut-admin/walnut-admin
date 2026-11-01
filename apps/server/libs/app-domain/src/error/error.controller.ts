import { Controller, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminExceptionDatabaseError } from '@walnut-server/exceptions/app/database'
import {
  WalnutAdminExceptionBadRequest,
  WalnutAdminExceptionForbidden,
  WalnutAdminExceptionGatewayTimeout,
  WalnutAdminExceptionHttpVersionNotSupported,
  WalnutAdminExceptionInternalServerError,
  WalnutAdminExceptionNotFound,
  WalnutAdminExceptionRequestTimeout,
  WalnutAdminExceptionUnauthorized,
} from '@walnut-server/exceptions/base.exception'
import {
  WalnutAdminExceptionDataExists,
  WalnutAdminExceptionInvalidID,
  WalnutAdminExceptionRequestDataError,
} from '@walnut-server/exceptions/base/400'

import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import {
  WalnutAdminExceptionDeviceBanned,
  WalnutAdminExceptionDeviceLocked,
  WalnutAdminExceptionDeviceNotAcceptable,
  WalnutAdminExceptionIPNotAcceptable,
  WalnutAdminExceptionNotAcceptable,
  WalnutAdminExceptionRiskTooHigh,
  WalnutAdminExceptionUserAgentBrowserNotAcceptable,
  WalnutAdminExceptionUserAgentNotAcceptable,
  WalnutAdminExceptionUserAgentOSNotAcceptable,
} from '@walnut-server/exceptions/base/406'

import { WalnutAdminExceptionServiceUnavailable, WalnutAdminExceptionServiceUnavailableDependencyDown } from '@walnut-server/exceptions/base/503'

import { WalnutAdminExceptionEndPointUnavailable } from '@walnut-server/exceptions/business/app'

import {
  WalnutAdminExceptionAccessTokenExpired,
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionDuplicateSignIn,
  WalnutAdminExceptionExpiredSignature,
  WalnutAdminExceptionInvalidCredential,
  WalnutAdminExceptionInvalidSignature,
  WalnutAdminExceptionMfaRequired,
  WalnutAdminExceptionMfaVerifyFailed,
  WalnutAdminExceptionNoAccessPermission,
  WalnutAdminExceptionNoAccessRolePermission,
  WalnutAdminExceptionOAuthFailed,
  WalnutAdminExceptionRefreshTokenExpired,
  WalnutAdminExceptionSensitiveVerificationFailed,
  WalnutAdminExceptionSignoutFailed,
  WalnutAdminExceptionSignupBanned,
  WalnutAdminExceptionUserBannedToSignin,
  WalnutAdminExceptionUserLocked,
  WalnutAdminExceptionYouAreBot,
} from '@walnut-server/exceptions/business/auth'

import { WalnutAdminExceptionRsaDecryptFailed, WalnutAdminExceptionRsaPubKeyNotFound } from '@walnut-server/exceptions/business/rsa'
import { WalnutAdminDecoratorDevOnly, WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorHasRole } from '@walnut-server/guards'

import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { AppRoutes, IWalnutAdminConstAppResponseCode, Role, WalnutAdminConstAppResponseCode } from '@walnut/contract'

const Permissions = {
  TEST: 'app:error:test',
} as const

@Controller(AppRoutes.ERROR)
@ApiTags('app/error')
@WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
@WalnutAdminDecoratorHasPermission(Permissions.TEST)
export class AppErrorController {
  constructor() {}

  @Get(':code')
  @WalnutAdminDecoratorDevOnly()
  error40000(
    @Param('code', new WalnutAdminPipeParamEnum(WalnutAdminConstAppResponseCode))
    code: IWalnutAdminConstAppResponseCode,
  ) {
    const ErrorMap: Partial<Record<IWalnutAdminConstAppResponseCode, new () => Error>> = {
      40000: WalnutAdminExceptionBadRequest,
      40001: WalnutAdminExceptionDataExists,
      40002: WalnutAdminExceptionInvalidID,
      40099: WalnutAdminExceptionRequestDataError,
      40011: WalnutAdminExceptionRsaDecryptFailed,
      40012: WalnutAdminExceptionRsaPubKeyNotFound,
      40100: WalnutAdminExceptionUnauthorized,
      40101: WalnutAdminExceptionAccessTokenExpired,
      40102: WalnutAdminExceptionRefreshTokenExpired,
      40103: WalnutAdminExceptionInvalidCredential,
      40104: WalnutAdminExceptionUserBannedToSignin,
      40105: WalnutAdminExceptionNoAccessPermission,
      40106: WalnutAdminExceptionNoAccessRolePermission,
      40107: WalnutAdminExceptionOAuthFailed,
      40108: WalnutAdminExceptionSignupBanned,
      40109: WalnutAdminExceptionDuplicateSignIn,
      40110: WalnutAdminExceptionSignoutFailed,
      40111: WalnutAdminExceptionYouAreBot,
      // P2-7：40112-40117 曾整体错位（40112 挂 CapInteractionRequired 等）——
      // 按 contract response-code + 各 guard 真实抛码逐个对齐：
      // 40112 InvalidSignature / 40113 ExpiredSignature / 40114 MfaRequired /
      // 40115 MfaVerifyFailed / 40116 CapInteractionRequired / 40117 CapRefreshRequired
      40112: WalnutAdminExceptionInvalidSignature,
      40113: WalnutAdminExceptionExpiredSignature,
      40114: WalnutAdminExceptionMfaRequired,
      40115: WalnutAdminExceptionMfaVerifyFailed,
      40116: WalnutAdminExceptionCapInteractionRequired,
      40117: WalnutAdminExceptionCapRefreshRequired,
      40118: WalnutAdminExceptionUserLocked,
      40119: WalnutAdminExceptionSensitiveVerificationFailed,
      40300: WalnutAdminExceptionForbidden,
      40400: WalnutAdminExceptionNotFound,
      40401: WalnutAdminExceptionDataNotFound,
      40600: WalnutAdminExceptionNotAcceptable,
      40601: WalnutAdminExceptionUserAgentOSNotAcceptable,
      40602: WalnutAdminExceptionUserAgentBrowserNotAcceptable,
      40603: WalnutAdminExceptionIPNotAcceptable,
      40604: WalnutAdminExceptionUserAgentNotAcceptable,
      40605: WalnutAdminExceptionDeviceNotAcceptable,
      40606: WalnutAdminExceptionDeviceLocked,
      40607: WalnutAdminExceptionDeviceBanned,
      40666: WalnutAdminExceptionRiskTooHigh,
      40800: WalnutAdminExceptionRequestTimeout,
      50000: WalnutAdminExceptionInternalServerError,
      50001: WalnutAdminExceptionDatabaseError,
      50300: WalnutAdminExceptionServiceUnavailable,
      50301: WalnutAdminExceptionEndPointUnavailable,
      50302: WalnutAdminExceptionServiceUnavailableDependencyDown,
      50400: WalnutAdminExceptionGatewayTimeout,
      50500: WalnutAdminExceptionHttpVersionNotSupported,
    }

    throw new (ErrorMap[code] as new () => Error)()
  }
}
