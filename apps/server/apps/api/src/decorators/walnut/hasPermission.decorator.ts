import type { IWalnutAdminConstDecoratorPermissionMode } from '@walnut/const/decorator/permissions'

import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import { WalnutAdminConstDecoratorPermissionMetadataKey } from '@walnut/const/decorator/permissions'
import { WalnutAdminGuardPermission } from '@/guard/permission.guard'

/**
 * @description Custom permission decorator, support for `permission(s)` and mode controll
 * !!! NOTICE !!! if you want to use `WalnutAdminDecoratorHasPermission` on controller level, MAKE SURE to put this decorator BEFORE jwt guard
 * Otherwise `request.user` will be undefined in context access
 * @link https://github.com/nestjs/docs.nestjs.com/issues/1567#issuecomment-731808138
 */
export function WalnutAdminDecoratorHasPermission(permission: string | string[], mode: IWalnutAdminConstDecoratorPermissionMode = 'and') {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorPermissionMetadataKey.PERMISSION, permission),
    SetMetadata(WalnutAdminConstDecoratorPermissionMetadataKey.PERMISSION_MODE, mode),
    UseGuards(WalnutAdminGuardPermission),
  )
}
