import type { IWalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'

import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import { WalnutAdminConstDecoratorFunctionalMetadataKey } from '@walnut-server/const/decorator/functional'

import { WalnutAdminGuardFunctional } from '@/guard/functional.guard'

/**
 * P1-17（2026-10-28）：`options.defaultClosed` 用于「未配置即关闭」的端点（Google 登录）。
 * 通用口径保持缺省放行（app_setting 空表 = 功能全开），只有显式 opt-in 的端点才要求
 * settings 里存在且值为 1。
 */
export function WalnutAdminDecoratorFunctionalGuard<T>(
  mainKey: IWalnutAdminConstAppSettingKeys,
  detailKey?: keyof T,
  options?: { defaultClosed?: boolean },
) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorFunctionalMetadataKey.MAIN_KEY, mainKey),
    SetMetadata(WalnutAdminConstDecoratorFunctionalMetadataKey.DETAIL_KEY, detailKey),
    SetMetadata(WalnutAdminConstDecoratorFunctionalMetadataKey.DEFAULT_CLOSED, options?.defaultClosed === true),
    UseGuards(WalnutAdminGuardFunctional),
  )
}
