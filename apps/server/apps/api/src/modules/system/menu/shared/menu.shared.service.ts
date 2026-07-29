import type { ClientSession } from 'mongoose'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppPermissionType, WalnutAdminConstAppPermissionType } from '@walnut-server/const/app/permission'
import { RoleType, Role } from '@walnut/contract'
import { arrToTree, filterTree, formatTree, orderTree, TreeNodeItem } from 'easy-fns-ts'
import { isNil, omit, pick } from 'lodash'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'
import { SysRoleSharedService } from '../../role/shared/role.shared.service'
import { SysMenuRepositoryService } from '../repo/menu.repo.service'
import { ISysMenuDocument, SysMenuModel, MenuTernal, MenuType } from '../schema/menu.schema'
// Note: Menu types (IMenuTreeItem, IVueRouteItem, ILayoutTabsItem, IIframeListItem) are now global

@Injectable()
export class SysMenuSharedService {
  private readonly logger = new Logger(SysMenuSharedService.name)

  constructor(
    private readonly sysMenuRepoService: SysMenuRepositoryService,
    private readonly roleSharedService: SysRoleSharedService,
    private readonly cachePermissionsService: AppTechCachePermissionsService,
  ) { }

  /**
   * @description get current user authorized permissions (for AuthController)
   */
  async getPermissions(
    user: IWalnutAdminAccessTokenPayload,
    deviceId: string,
  ) {
    const res = await this.getCorePermissions(user, WalnutAdminConstAppPermissionType.ALL)

    // set permission to cache
    await this.cachePermissionsService.setPermissions(user, deviceId, res.permissionStrings)

    return res
  }

  /**
   * @description delete permission from cache
   */
  async delPermissionFromCache(userId: string, deviceId: string) {
    await this.cachePermissionsService.delPermissions(userId, deviceId)
  }

  /**
   * @description get current user authorized permission strings
   */
  async getCorePermissionStrings(user: IWalnutAdminAccessTokenPayload) {
    const { permissionStrings } = await this.getCorePermissions(user, WalnutAdminConstAppPermissionType.STRINGS)
    return permissionStrings
  }

  /**
   * @overload
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: typeof WalnutAdminConstAppPermissionType.STRINGS
  ): Promise<{
    permissionStrings: string[]
  }>

  /**
   * @overload
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: typeof WalnutAdminConstAppPermissionType.MENUS
  ): Promise<{
    permissionMenuTree: TreeNodeItem<IMenuTreeItem>[]
  }>

  /**
   * @overload
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: typeof WalnutAdminConstAppPermissionType.ROUTES
  ): Promise<{
    permissionRoutes: TreeNodeItem<IVueRouteItem>[]
  }>

  /**
   * @overload
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: typeof WalnutAdminConstAppPermissionType.ALL
  ): Promise<{
    permissionStrings: string[]
    permissionMenuTree: TreeNodeItem<IMenuTreeItem>[]
    permissionRouteTree: TreeNodeItem<IVueRouteItem>[]
    keepAliveNames: string[]
    affixedTabs: ILayoutTabsItem[]
    indexMenuName: string
    internalIframeList: IIframeListItem[]
  }>

  /**
   * @description Since roleIds is written in token, so if admin changed some user's role,
   * this user need to signout and re-signin to gain new permitted menus
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: IWalnutAdminConstAppPermissionType = WalnutAdminConstAppPermissionType.ALL,
  ) {
    const { menus, roleNames } = await this.roleSharedService.getCoreMenus(user)

    // root/visitor has all permissions
    const menuArr = ([Role.ROOT, Role.VISITOR] as RoleType[]).includes(roleNames[0])
      ? await this.sysMenuRepoService.findAllMenus()
      : [
          await this.sysMenuRepoService.findRootMenu(),
          ...menus,
        ]

    const processedMenuArr = menuArr
      .filter(i => i !== null)
      .map(i => i.toObject<ISysMenuDocument>({ flattenObjectIds: true }))
      .filter(Boolean)

    const processors = {
      [WalnutAdminConstAppPermissionType.STRINGS]: () => ({
        permissionStrings: this.getStrings(processedMenuArr),
      }),
      [WalnutAdminConstAppPermissionType.MENUS]: () => ({
        permissionMenuTree: this.getMenuTree(processedMenuArr),
      }),
      [WalnutAdminConstAppPermissionType.ROUTES]: () => ({
        permissionRoutes: this.getRouteTree(processedMenuArr),
      }),
      [WalnutAdminConstAppPermissionType.ALL]: () => {
        const permissionStrings = this.getStrings(processedMenuArr)
        const keepAliveNames = processedMenuArr
          .filter(i => i.type === MenuType.MENU && i.meta?.ternal !== MenuTernal.EXTERNAL && i.meta?.cache)
          .map(i => i.name)
          .filter(Boolean)
        const affixedTabs = this.getLayoutTabs(processedMenuArr)
        const permissionMenuTree = this.getMenuTree(processedMenuArr)
        const permissionRoutes = this.getRouteTree(processedMenuArr)
        const indexMenuName = this.getIndexMenuName(permissionMenuTree[0].children![0])
        const internalIframeList = this.getIframeList(processedMenuArr)

        return {
          permissionStrings,
          permissionMenuTree: permissionMenuTree[0]?.children ?? [],
          permissionRouteTree: permissionRoutes[0]?.children ?? [],
          keepAliveNames,
          affixedTabs,
          indexMenuName,
          internalIframeList,
        }
      },
    }

    const processor = Reflect.has(processors, permissionType) ? processors[permissionType] : processors[WalnutAdminConstAppPermissionType.ALL]
    return processor()
  }

  // get current user permission strings
  private getStrings(data: ISysMenuDocument[]) {
    return data.filter(i => Boolean(i.meta?.permission)).map(i => i.meta?.permission)
  }

  // get current user menu tree
  private getMenuTree(data: SysMenuModel[]): TreeNodeItem<IMenuTreeItem>[] {
    // item that is not type ELEMENT
    const inputPayload = data.filter(
      i => i.type !== MenuType.ELEMENT,
    )

    // build tree
    const treeMenu = arrToTree(inputPayload, { id: '_id' })

    // order tree
    const treeOrdered = orderTree(treeMenu, (a, b) => a.meta.order - b.meta.order)

    // empty children for type not CATALOG
    const formattedTree = formatTree(treeOrdered, node => node.type !== MenuType.CATALOG ? Object.assign(node, { children: [] }) : node)

    return formattedTree
  }

  // get index menu name
  private getIndexMenuName(node: IMenuTreeItem) {
    if (isNil(node)) {
      return ''
    }

    // menu root
    if (node.type === MenuType.MENU) {
      return node.name
    }

    // catelog root
    if (node.type === MenuType.CATALOG && node.children && node.children.length) {
      for (const child of node.children) {
        const menuName = this.getIndexMenuName(child) as string
        if (menuName) {
          return menuName
        }
      }
    }
  }

  // get current user route tree
  private getRouteTree(data: SysMenuModel[]) {
    // item that is not type ELEMENT
    const inputPayload = data.filter(
      i => i.type !== MenuType.ELEMENT,
    )

    // build tree
    const treeMenu = arrToTree(inputPayload, { id: '_id' })

    // order tree
    const treeOrdered = orderTree(treeMenu, (a, b) => a.meta.order - b.meta.order, { id: '_id' })

    // format tree to vue route structure
    const formattedTree = formatTree<SysMenuModel, IVueRouteItem>(treeOrdered, (node) => {
      const n = node.children?.length === 0 ? omit(node, 'children') : node

      return {
        ...n,
        meta: {
          ...n.meta,
          ...pick(n, ['title', 'type', 'icon']),
        },
      }
    }, { id: '_id' })

    return formattedTree
  }

  // get tabs data
  private getLayoutTabs(data: SysMenuModel[]) {
    return data
      .filter(i => i.type === MenuType.MENU && i.meta?.affix)
      .sort((a, b) => b.meta?.order - a.meta?.order)
      .map(i => ({
        ...i,
        meta: {
          ...i.meta,
          ...pick(i, ['title', 'type', 'icon']),
        },
      }))
  }

  // get iframe list
  private getIframeList(data: SysMenuModel[]) {
    return data.filter(i => i.meta?.ternal === MenuTernal.INTERNAL && !!i.meta?.url)
      .map(i => ({
        name: i.name,
        url: i.meta?.url,
        cache: i.meta?.cache,
      }))
  }

  /**
   * @description get full menu tree (for controller)
   */
  async getMenuTreeAndTreeWithoutTypeElement(dbSession?: ClientSession) {
    const allMenus = await this.sysMenuRepoService.findAllMenus(dbSession)

    const rawMenus: SysMenuModel[] = allMenus.map(i => i.toObject({ flattenObjectIds: true }))

    // also remove empty children
    const fullTree = formatTree(orderTree(
      arrToTree(rawMenus, { id: '_id' }),
      (a, b) => Number(a.meta?.order) - Number(b.meta?.order),
    ), (node: TreeNodeItem<SysMenuModel>) => {
      return node.children?.length === 0 ? omit(node, 'children') : node
    })

    // used for parent node select
    const treeWithoutTypeElement = filterTree(fullTree, node => node.type !== MenuType.ELEMENT)

    // menu active name select options
    const menuActiveNamesOptions = rawMenus.filter(i => i.type === MenuType.MENU)
      .map(i => ({
        name: i.name,
        title: i.title,
      }))

    return {
      fullTree: fullTree[0].children,
      treeWithoutTypeElement,
      menuActiveNamesOptions,
    }
  }
}
