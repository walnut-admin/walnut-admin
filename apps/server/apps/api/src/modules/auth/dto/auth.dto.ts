import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldObject, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { RealPickType } from '@walnut-server/utils/dto'
import { SysMenuDTOSafe, SysMenuDTOTree } from '@/modules/system/menu/dto/menu.dto'
import { SysMenuModelMeta } from '@/modules/system/menu/schema/menu.schema'
// Note: Menu types (IMenuTreeItem, IVueRouteItem, ILayoutTabsItem, IIframeListItem) are now global

export class AuthSuccessDTO {
  constructor(partial: Partial<AuthSuccessDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({})
  accessToken: string

  @WalnutAdminDecoratorFieldString({})
  sessionKey: string
}

class VueRouteMetaDTO extends IntersectionType(SysMenuModelMeta, RealPickType(SysMenuDTOSafe, ['type', 'title', 'icon'] as const)) {}

// route tree dto
class AuthPermissionRouteTreeDTO extends RealPickType(SysMenuDTOSafe, ['name', 'path', 'component']) {
  @WalnutAdminDecoratorFieldObject(VueRouteMetaDTO, {})
  meta: VueRouteMetaDTO

  @WalnutAdminDecoratorFieldObject(AuthPermissionRouteTreeDTO, {
    isArray: true,
    swaggerOptions: {
      title: 'children routes',
    },
  })
  children: AuthPermissionRouteTreeDTO[]
}

// layout affixed tab items
class AuthPermissionAffixedTabsDTO extends RealPickType(SysMenuDTOSafe, ['name', 'path']) {
  @WalnutAdminDecoratorFieldObject(VueRouteMetaDTO, {})
  meta: VueRouteMetaDTO
}

// internal iframe list dto
class AuthPermissionInternalIframeDTO extends IntersectionType(
  RealPickType(SysMenuDTOSafe, [
    'name',
  ] as const),
  RealPickType(SysMenuModelMeta, [
    'url',
    'cache',
  ] as const),
) {
  constructor(partial: Partial<AuthPermissionInternalIframeDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AuthCorePermissionsDTO {
  constructor(partial: Partial<AuthCorePermissionsDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysMenuDTOTree, {
    isArray: true,
    swaggerOptions: {
      title: 'permission menu tree current user has',
    },
  })
  permissionMenuTree: IMenuTreeItem[]

  @WalnutAdminDecoratorFieldObject(AuthPermissionRouteTreeDTO, {
    isArray: true,
    swaggerOptions: {
      title: 'permission route tree current user has',
    },
  })
  permissionRouteTree: IVueRouteItem[]

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    arrayOptions: { unique: true },
    swaggerOptions: {
      title: 'all the permission strings current user has',
    },
  })
  permissionStrings: string[]

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    arrayOptions: { unique: true },
    swaggerOptions: {
      title: 'keep alive menu names list',
    },
  })
  keepAliveNames: string[]

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'index menu name, for page initial',
    },
  })
  indexMenuName: string

  @WalnutAdminDecoratorFieldObject(AuthPermissionAffixedTabsDTO, {
    isArray: true,
    swaggerOptions: {
      title: 'affixed tabs current user has',
    },
  })
  affixedTabs: ILayoutTabsItem[]

  @WalnutAdminDecoratorFieldObject(AuthPermissionInternalIframeDTO, {
    isArray: true,
    swaggerOptions: {
      title: 'internal iframe list current user has',
    },
  })
  internalIframeList: IIframeListItem[]
}
