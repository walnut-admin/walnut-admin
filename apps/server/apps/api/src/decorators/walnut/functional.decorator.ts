import type { IWalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'

import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import { WalnutAdminConstDecoratorFunctionalMetadataKey } from '@walnut-server/const/decorator/functional'

import { WalnutAdminGuardFunctional } from '@/guard/functional.guard'

export function WalnutAdminDecoratorFunctionalGuard<T>(mainKey: IWalnutAdminConstAppSettingKeys, detailKey?: keyof T) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorFunctionalMetadataKey.MAIN_KEY, mainKey),
    SetMetadata(WalnutAdminConstDecoratorFunctionalMetadataKey.DETAIL_KEY, detailKey),
    UseGuards(WalnutAdminGuardFunctional),
  )
}
