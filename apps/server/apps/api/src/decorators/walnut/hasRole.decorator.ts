import type { IWalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import type { RoleType } from '@walnut/contract'

import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import { WalnutAdminConstDecoratorRoleMetadataKey } from '@walnut-server/const/decorator/role'

import { WalnutAdminGuardRole } from '../../guard/roles.guard'

/**
 * @description Custom role decorator, support for `role(s)` and mode controll
 * !!! NOTICE !!! if you want to use `WalnutAdminDecoratorHasRole` on controller level, MAKE SURE to put this decorator BEFORE jwt guard
 * Otherwise `request.user` will be undefined in context access
 * @link https://github.com/nestjs/docs.nestjs.com/issues/1567#issuecomment-731808138
 */
export function WalnutAdminDecoratorHasRole(roles: RoleType | RoleType[], mode: IWalnutAdminConstDecoratorRoleMode = 'and') {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorRoleMetadataKey.ROLE, roles),
    SetMetadata(WalnutAdminConstDecoratorRoleMetadataKey.ROLE_MODE, mode),
    UseGuards(WalnutAdminGuardRole),
  )
}
