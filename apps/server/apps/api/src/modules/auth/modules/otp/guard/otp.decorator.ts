import type { Type } from '@nestjs/common'
// Note: IWalnutAdminOtpThrottleConfigProvider has been moved to global IWalnutAdminOtpThrottleConfigProvider
import { applyDecorators, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common'
import { OTP_THROTTLE_SERVICE_KEY, OtpFunctionalGuard, OtpSendFunctionalGuard, OtpThrottleGuard } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutAdminConstDecoratorLogAuthMetadataKey, WalnutAdminInterceptorRequestAuthLog } from '@walnut-server/guards'

// P1-16（2026-10-28）：元数据键与 guard 共享（otp-throttle.const.ts）—— 旧实现 decorator
// 写 Symbol、guard 读字符串，动态 sendLimit/sendTtl 从未生效。

/**
 * Decorator to enable functional guard for OTP auth endpoint
 * Dynamically checks if OTP auth is enabled based on request type
 */
export function OtpDecoratorFunctionalGuard() {
  return applyDecorators(
    UseGuards(OtpFunctionalGuard),
  )
}

/**
 * Decorator to enable functional guard for OTP send endpoint
 * Dynamically checks if OTP send is enabled based on request type
 */
export function OtpDecoratorSendFunctionalGuard() {
  return applyDecorators(
    UseGuards(OtpSendFunctionalGuard),
  )
}

/**
 * Decorator to enable throttling for OTP endpoints
 * Dynamically applies rate limits based on request type
 */
export function OtpDecoratorThrottle(service: Type<any>) {
  return applyDecorators(
    SetMetadata(OTP_THROTTLE_SERVICE_KEY, service),
    UseGuards(OtpThrottleGuard),
  )
}

/**
 * Decorator to enable dynamic auth logging for OTP endpoints
 * Automatically determines log type (EMAIL or PHONE) based on request body type
 */
export function OtpDecoratorAuthLog() {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorLogAuthMetadataKey, WalnutAdminConstDecoratorLogAuthType.OTP),
    UseInterceptors(WalnutAdminInterceptorRequestAuthLog),
  )
}
