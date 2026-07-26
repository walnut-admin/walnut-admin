import { Controller, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut/const/decorator/role'
import { WalnutAdminConstRole } from '@walnut/const/role/index'
import { WalnutAdminExceptionDatabaseError } from '@walnut/exceptions/app/database'

import {
  WalnutAdminExceptionBadRequest,
  WalnutAdminExceptionForbidden,
  WalnutAdminExceptionGatewayTimeout,
  WalnutAdminExceptionHttpVersionNotSupported,
  WalnutAdminExceptionInternalServerError,
  WalnutAdminExceptionNotFound,
  WalnutAdminExceptionRequestTimeout,
  WalnutAdminExceptionUnauthorized,
} from '@walnut/exceptions/base.exception'

import {
  WalnutAdminExceptionDataExists,
  WalnutAdminExceptionInvalidID,
  WalnutAdminExceptionRequestDataError,
} from '@walnut/exceptions/base/400'

import { WalnutAdminExceptionDataNotFound } from '@walnut/exceptions/base/404'

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
} from '@walnut/exceptions/base/406'

import { WalnutAdminExceptionServiceUnavailable, WalnutAdminExceptionServiceUnavailableDependencyDown } from '@walnut/exceptions/base/503'

import { WalnutAdminExceptionEndPointUnavailable } from '@walnut/exceptions/business/app'
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
} from '@walnut/exceptions/business/auth'

import { WalnutAdminExceptionRsaDecryptFailed, WalnutAdminExceptionRsaPubKeyNotFound } from '@walnut/exceptions/business/rsa'
import { WalnutAdminPipeParamEnum } from '@walnut/pipes'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminDecoratorDevOnly } from '@/guard/env.guard'

const Permissions = {
  TEST: 'app:error:test',
} as const

@Controller('app/error')
@ApiTags('app/error')
@WalnutAdminDecoratorHasRole([WalnutAdminConstRole.ROOT, WalnutAdminConstRole.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
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
      40112: WalnutAdminExceptionCapInteractionRequired,
      40113: WalnutAdminExceptionCapRefreshRequired,
      40114: WalnutAdminExceptionInvalidSignature,
      40115: WalnutAdminExceptionExpiredSignature,
      40116: WalnutAdminExceptionMfaRequired,
      40117: WalnutAdminExceptionMfaVerifyFailed,
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
