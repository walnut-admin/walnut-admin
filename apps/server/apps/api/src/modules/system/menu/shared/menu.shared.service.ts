import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppPermissionType, WalnutAdminConstAppPermissionType } from '@walnut-server/const/app/permission'
import { Role, RoleType } from '@walnut/contract'
import { MenuTernal, MenuType } from '@walnut/contract/menu'
import { arrToTree, filterTree, formatTree, orderTree, TreeNodeItem } from 'easy-fns-ts'
import { isNil, omit, pick } from 'lodash'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'
import { SysRoleSharedService } from '../../role/shared/role.shared.service'
import { assembleSysMenu, ISysMenuAssembled } from '../dto/menu.dto'
import { SysMenuEntity } from '../entity/menu.entity'
import { SysMenuRepositoryService } from '../repo/menu.repo.service'
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
   * @description 失效某用户**全部设备**的权限缓存
   * （P2-32：改密/敏感操作全设备下线 —— 缓存键按 `<userId>:<deviceId>` 分布，
   * 服务端没有反查设备的通道，按前缀一次清干净）
   */
  async clearUserPermissionsCache(userId: string) {
    await this.cachePermissionsService.delPermissionsForUser(userId)
  }

  /**
   * @description 全量失效权限缓存（P2-16：菜单写路径 —— 菜单行的 permission/status/
   * 删除会影响「角色 → 菜单 → 权限串」的所有用户。按 menu 维度反查不可行，权限缓存
   * 又能由客户端重拉 `/auth/permissions` 重建，所以这里明确取舍为全清前缀）。
   */
  async clearAllPermissionsCache() {
    await this.cachePermissionsService.delAllPermissions()
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
   * @description P1-18 根修（2026-10-28）：roleIds 虽写在 AT payload（登录快照），
   * `getCoreMenus` 会先按 `sys_user_role` 实时 membership 过滤 —— 管理端改了角色后，
   * 重新拉 `/auth/permissions` 即按新绑定计算，无需重新登录；恢复用户（junction 未恢复）
   * 的权限为空。
   */
  async getCorePermissions(
    user: IWalnutAdminAccessTokenPayload,
    permissionType: IWalnutAdminConstAppPermissionType = WalnutAdminConstAppPermissionType.ALL,
  ) {
    const { menus, roleNames } = await this.roleSharedService.getCoreMenus(user)

    // root/visitor has all permissions
    // P3-18：非 root 路径也取**全部根**（此前 findRootMenu 只取一根，多根部署下
    // 其他根下的授权菜单在 arrToTree 里成为孤儿子树被丢弃）
    const menuArr: (SysMenuEntity | null | ISysMenuAssembled)[] = ([Role.ROOT, Role.VISITOR] as RoleType[]).includes(roleNames[0])
      ? await this.sysMenuRepoService.findAllMenus()
      : [
          ...await this.sysMenuRepoService.findAllRootMenus(),
          ...menus,
        ]

    // B5：实体（拍平列）→ meta 组装回对象的 POJO（assembleSysMenu 幂等，role populate
    // 侧已组装的行重复调用结果不变）；PG 实体即 POJO，无需 toObject
    const processedMenuArr: ISysMenuAssembled[] = menuArr
      .filter((i): i is SysMenuEntity | ISysMenuAssembled => i !== null)
      .map(i => assembleSysMenu(i))

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
        // P3-18：多根部署下顶层 = 全部根的 children 拼接（单根形态与旧 wire 完全一致，
        // 根节点本身仍不进菜单树/路由树 —— 与 admin 菜单渲染的「根 → children」契约对齐）。
        const permissionMenuTopLevel = permissionMenuTree.flatMap(root => root.children ?? [])
        const permissionRouteTopLevel = permissionRoutes.flatMap(root => root.children ?? [])
        // P1-8 修复（2026-10-28）：sys_menu 空表时 permissionMenuTree 为空数组 ——
        // 旧写法 `[0].children![0]` 在 undefined 上解引用 → TypeError → 50000。
        // 空树回空 indexMenuName（受控空形态）。
        const indexMenuName = this.getIndexMenuName(permissionMenuTopLevel[0])
        const internalIframeList = this.getIframeList(processedMenuArr)

        return {
          permissionStrings,
          permissionMenuTree: permissionMenuTopLevel,
          permissionRouteTree: permissionRouteTopLevel,
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
  private getStrings(data: ISysMenuAssembled[]) {
    return data.filter(i => Boolean(i.meta?.permission)).map(i => i.meta?.permission)
  }

  // get current user menu tree
  private getMenuTree(data: ISysMenuAssembled[]): TreeNodeItem<IMenuTreeItem>[] {
    // item that is not type ELEMENT
    const inputPayload = data.filter(
      i => i.type !== MenuType.ELEMENT,
    )

    // build tree（B5：Mongo 版以 _id 建树，PG 版主键是 id）
    const treeMenu = arrToTree(inputPayload, { id: 'id', pid: 'pid' })

    // order tree
    const treeOrdered = orderTree(treeMenu, (a, b) => a.meta.order - b.meta.order)

    // empty children for type not CATALOG
    const formattedTree = formatTree(treeOrdered, node => node.type !== MenuType.CATALOG ? Object.assign(node, { children: [] }) : node)

    return formattedTree
  }

  // get index menu name（P1-8：空树/空节点回 ''，调用方不再依赖非空断言）
  private getIndexMenuName(node?: IMenuTreeItem): string {
    if (isNil(node)) {
      return ''
    }

    // menu root
    if (node.type === MenuType.MENU) {
      return node.name ?? ''
    }

    // catelog root
    if (node.type === MenuType.CATALOG && node.children && node.children.length) {
      for (const child of node.children) {
        const menuName = this.getIndexMenuName(child)
        if (menuName) {
          return menuName
        }
      }
    }

    return ''
  }

  // get current user route tree
  private getRouteTree(data: ISysMenuAssembled[]) {
    // item that is not type ELEMENT
    const inputPayload = data.filter(
      i => i.type !== MenuType.ELEMENT,
    )

    // build tree（B5：_id → id）
    const treeMenu = arrToTree(inputPayload, { id: 'id', pid: 'pid' })

    // order tree
    const treeOrdered = orderTree(treeMenu, (a, b) => a.meta.order - b.meta.order, { id: 'id' })

    // format tree to vue route structure
    const formattedTree = formatTree<ISysMenuAssembled, IVueRouteItem>(treeOrdered, (node) => {
      const n = node.children?.length === 0 ? omit(node, 'children') : node

      return {
        ...n,
        meta: {
          ...n.meta,
          ...pick(n, ['title', 'type', 'icon']),
        },
      }
    }, { id: 'id' })

    return formattedTree
  }

  // get tabs data
  private getLayoutTabs(data: ISysMenuAssembled[]) {
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
  private getIframeList(data: ISysMenuAssembled[]) {
    return data.filter(i => i.meta?.ternal === MenuTernal.INTERNAL && !!i.meta?.url)
      .map(i => ({
        name: i.name,
        url: i.meta?.url,
        cache: i.meta?.cache,
      }))
  }

  /**
   * @description get full menu tree (for controller)
   *
   * 菜单树形态对照 Mongo 版：单次全量查询 + 内存建树（克制实现，不逐层懒加载）；
   * P1-8 修复（2026-10-28）：查无菜单时 fullTree 为空 —— 旧实现直接解引用
   * `fullTree[0].children` → TypeError → 50000；改为受控空树。
   * P3-18：多根部署下 fullTree = 全部根的 children 拼接（单根形态与旧 wire 一致；
   * 根节点本身仍不进 fullTree —— 台账树/角色授权的数据结构以「根下第一层」为顶层）。
   */
  async getMenuTreeAndTreeWithoutTypeElement(em?: EntityManager) {
    const allMenus = await this.sysMenuRepoService.findAllMenus(em)

    const rawMenus: ISysMenuAssembled[] = allMenus.map(i => assembleSysMenu(i))

    // also remove empty children（R 与 T 同型显式标注：omit 掉 children 的行仍是同型节点）
    const fullTree = formatTree<TreeNodeItem<ISysMenuAssembled>, TreeNodeItem<ISysMenuAssembled>>(
      orderTree(
        arrToTree(rawMenus, { id: 'id', pid: 'pid' }),
        (a, b) => Number(a.meta?.order) - Number(b.meta?.order),
      ),
      (node) => {
        return node.children?.length === 0 ? omit(node, 'children') : node
      },
    )

    // used for parent node select
    const treeWithoutTypeElement = filterTree(fullTree, node => node.type !== MenuType.ELEMENT)

    // menu active name select options
    const menuActiveNamesOptions = rawMenus.filter(i => i.type === MenuType.MENU)
      .map(i => ({
        name: i.name,
        title: i.title,
      }))

    return {
      fullTree: fullTree.flatMap(root => root.children ?? []),
      treeWithoutTypeElement,
      menuActiveNamesOptions,
    }
  }
}
