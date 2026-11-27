/**
 * 模块 spec ①：菜单（树形 / CRUD / 权限串生效路径）。
 *
 * 服务端真源（写断言前已对照）：
 * - `/system/menu/tree` 返回 `{ fullTree, treeWithoutTypeElement, menuActiveNamesOptions }`
 *   （`menu.shared.service.getMenuTreeAndTreeWithoutTypeElement`）：fullTree 是**去掉合成根**的
 *   全量树；treeWithoutTypeElement 递归过滤 `type === element`；
 * - create/read/update/delete 都由 controller 调 `assembleSysMenu` 把 19 个拍平列组装回 `meta`
 *   （`menu.dto.ts`），所以 wire 上断言的是 `meta.permission` 而不是拍平列；
 * - create 的必填集只有 `type`（`SysMenuDTOCreateRequest`），其余字段与 meta 均可选；
 * - `/auth/permissions` 对 root 走 `findAllMenus()`（所有菜单的 permission 列派生
 *   `permissionStrings`）—— 新造 element 的权限串会在下一次调用里出现，改 permission 后旧串消失；
 * - 权限相关列变化才清 `AUTH:PERMISSIONS:*`（F3 收窄）：改 title 不清，改 permission 全清
 *   （`menu.service.ts` 的 `isPermissionAffectingUpdate`）。**这是本用例的负对照对**。
 *
 * 为什么优先复用 seed 行做只读断言：seed 有 172 行菜单（106 element），树形 / 权限串的形态
 * 比新造两行更有代表性；写路径再用唯一前缀新造 catalog + element，避免污染 seed 行。
 */
import type { SystemMenu, SystemMenuMeta, SystemMenuTree, SystemMenuTreeResponse } from '@walnut/api-types'
import type { SystemMenuListPage } from '../../lib/protocol/api-types.ts'
import { randomBytes } from 'node:crypto'
import { countDeletedRows, findRootMenuId, findUserIdByUserName, withPg } from '../../lib/pg.ts'
import {
  AuthRoutes,
  MenuType,
  SystemEndpointRoutes,
  SystemRoutes,
} from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { permissionsCachePattern, scanKeys, withRedis } from '../../lib/redis.ts'
import { readCredentials } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'

/** 种子里一个稳定 element 菜单的权限串（只读断言用；与 sys_menu.json 同源） */
const SEED_MENU_PERMISSION = 'system:menu:create'

function flattenTree(nodes: SystemMenuTree[]): SystemMenuTree[] {
  const out: SystemMenuTree[] = []
  for (const node of nodes) {
    out.push(node)
    if (node.children !== undefined) {
      out.push(...flattenTree(node.children))
    }
  }
  return out
}

function findNode(nodes: SystemMenuTree[], id: string): SystemMenuTree | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const child = node.children === undefined ? null : findNode(node.children, id)
    if (child !== null) {
      return child
    }
  }
  return null
}

/**
 * treeWithoutTypeElement 的 wire 语义（2026-11 F1 起）：**递归**过滤 `type === element` ——
 * 命中的 catalog/menu 不豁免其后代，element 在任何层级都不出现。服务端实现是
 * `@walnut-server/utils` 的递归 `filterTree`（未命中但有命中后代的节点保留为祖先路径）。
 */
function expectNoElementDeep(nodes: SystemMenuTree[]): void {
  for (const node of flattenTree(nodes)) {
    expect(node.type, `treeWithoutTypeElement 出现了 element 行（${node.id}）`).not.toBe(MenuType.ELEMENT)
  }
}

async function permissionStrings(client: Awaited<ReturnType<typeof rootClient>>): Promise<string[]> {
  const permissions = await client.root<{ permissionStrings: string[] }>('GET', AuthRoutes.PERMISSIONS)
  return permissions.permissionStrings
}

/**
 * update 载荷（admin 表单口径：读回整行后整行回传）。
 *
 * 服务端 update 自 2026-11 F1 起是真 PATCH：未提供的顶层列不写 NULL；显式 null 才是清空。
 * 这里的整行载荷仍代表真实客户端（admin 的编辑表单总是回传整行），
 * partial 语义由下面两条独立用例钉住。
 */
function menuUpdatePayload(menu: SystemMenu, patch: { title?: string, meta?: SystemMenuMeta }): Record<string, unknown> {
  return {
    type: menu.type,
    pid: menu.pid,
    path: menu.path,
    name: menu.name,
    component: menu.component,
    title: patch.title ?? menu.title,
    icon: menu.icon,
    meta: patch.meta ?? menu.meta,
  }
}

test('菜单：树形 + seed 权限串只读断言 → 新建 / 改权限生效 → 权限变更清缓存 → 软删审计', { tag: '@smoke' }, async () => {
  const root = await rootClient()
  const credentials = readCredentials()
  const adminUserId = await withPg(pg => findUserIdByUserName(pg, credentials.userName))
  const prefix = `e2e-menu-${Date.now()}-${randomBytes(2).toString('hex')}`
  let catalogId = ''
  let elementId = ''

  try {
    // 1. 只读：seed 的树形与权限串（不写库）
    const tree = await root.root<SystemMenuTreeResponse>('GET', SystemEndpointRoutes.MENU_TREE)
    expect(Array.isArray(tree.fullTree), 'menu/tree 缺 fullTree 数组').toBe(true)
    expect(tree.fullTree.length, 'fullTree 为空（seed 应有 172 行菜单）').toBeGreaterThan(0)
    expect(Array.isArray(tree.treeWithoutTypeElement), 'menu/tree 缺 treeWithoutTypeElement 数组').toBe(true)
    expect(Array.isArray(tree.menuActiveNamesOptions), 'menu/tree 缺 menuActiveNamesOptions 数组').toBe(true)

    // 树形结构硬证据：至少一个节点有子节点；treeWithoutTypeElement 任何层级都没有 element
    const seedNodes = flattenTree(tree.fullTree)
    expect(seedNodes.some(node => node.children !== undefined && node.children.length > 0), 'fullTree 没有任何父子关系').toBe(true)
    expectNoElementDeep(tree.treeWithoutTypeElement)

    const seedElement = seedNodes.find(node => node.type === MenuType.ELEMENT && node.meta.permission === SEED_MENU_PERMISSION)
    expect(seedElement, `fullTree 里找不到 seed 权限串 ${SEED_MENU_PERMISSION}`).not.toBeUndefined()
    expect(typeof seedElement!.meta.permission).toBe('string')
    await expect(permissionStrings(root)).resolves.toContain(SEED_MENU_PERMISSION)

    // 2. 新建 catalog（挂在 seed 根下 —— 菜单树端点按「单一合成根」返回 fullTree，
    //    新造 pid=NULL 的根节点自身不会出现在 fullTree 里，见 lib/pg.ts findRootMenuId）
    const seedRootId = await withPg(pg => findRootMenuId(pg))
    const catalog = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.CATALOG,
      pid: seedRootId,
      name: `${prefix}-cat`,
      title: `${prefix}-cat-title`,
      meta: { order: 5, status: true, show: true },
    })
    catalogId = catalog.id
    expect(catalog.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(catalog.pid).toBe(seedRootId)
    expect(catalog.type).toBe(MenuType.CATALOG)
    expect(catalog.meta.permission).toBeNull()
    expect(catalog.meta.order).toBe(5)
    expect(catalog.meta.status).toBe(true)
    // 未给的 meta 键按实体 @Column 默认值回填（transition='fade' 是 entity DDL 默认）
    expect(catalog.meta.transition).toBe('fade')

    // 3. 新建 element（挂在 catalog 下；权限串是 write 路径的唯一前缀）
    const elementPermission = `${prefix}:read`
    const element = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.ELEMENT,
      pid: catalogId,
      name: `${prefix}-el`,
      meta: { permission: elementPermission, order: 6, status: true },
    })
    elementId = element.id
    expect(element.pid).toBe(catalogId)
    expect(element.meta.permission).toBe(elementPermission)

    // 4. 权限串生效：root 的 permissionStrings 来自全部菜单的 permission 列
    await expect(permissionStrings(root)).resolves.toContain(elementPermission)

    // 权限缓存确实由 /auth/permissions 写入（服务端 setPermissions；这个键不是 fixture 伪造的）
    const cachedAfterPermissionCall = await withRedis(redis => scanKeys(redis, permissionsCachePattern(adminUserId)))
    expect(cachedAfterPermissionCall.length, '/auth/permissions 后没有写 AUTH:PERMISSIONS 缓存').toBeGreaterThan(0)

    // 树里能看到父子关系
    const treeAfterCreate = await root.root<SystemMenuTreeResponse>('GET', SystemEndpointRoutes.MENU_TREE)
    const catalogNode = findNode(treeAfterCreate.fullTree, catalogId)
    expect(catalogNode, '新建 catalog 没有出现在 fullTree 里').not.toBeNull()
    expect(catalogNode!.children?.some(child => child.id === elementId), 'element 没有挂到 catalog 下').toBe(true)

    // 5. 改 permission：新串出现、旧串消失，且权限缓存被全量清掉（F3：permission 变化才清）
    const updatedPermission = `${prefix}:update`
    const currentElement = await root.root<SystemMenu>('GET', `${SystemRoutes.MENU}/${elementId}`)
    const updated = await root.root<SystemMenu>('PUT', `${SystemRoutes.MENU}/${elementId}`, menuUpdatePayload(currentElement, {
      meta: { ...currentElement.meta, permission: updatedPermission },
    }))
    expect(updated.meta.permission).toBe(updatedPermission)

    // 先看缓存（update 后服务端清全量），再重拉 /auth/permissions —— 反过来会把新键写回去，
    // 断言就变成永假 / 永真的空转（R4 实施时踩到过的顺序坑）。
    expect(
      await withRedis(redis => scanKeys(redis, permissionsCachePattern(adminUserId))),
      'permission 变化后 AUTH:PERMISSIONS 缓存没有被清掉',
    ).toEqual([])

    const stringsAfterUpdate = await permissionStrings(root)
    expect(stringsAfterUpdate, '改 permission 后新权限串没有生效').toContain(updatedPermission)
    expect(stringsAfterUpdate, '改 permission 后旧权限串仍然存在').not.toContain(elementPermission)

    // 6. 负对照：只改 title 不清权限缓存（F3 收窄的直接判据）
    await permissionStrings(root) // 重新写一份缓存
    const cachedBeforeTitleUpdate = await withRedis(redis => scanKeys(redis, permissionsCachePattern(adminUserId)))
    expect(cachedBeforeTitleUpdate.length).toBeGreaterThan(0)

    const currentCatalog = await root.root<SystemMenu>('GET', `${SystemRoutes.MENU}/${catalogId}`)
    const renamed = await root.root<SystemMenu>('PUT', `${SystemRoutes.MENU}/${catalogId}`, menuUpdatePayload(currentCatalog, {
      title: `${prefix}-cat-title-renamed`,
    }))
    expect(renamed.title).toBe(`${prefix}-cat-title-renamed`)
    expect(renamed.meta.permission, 'title-only update 不应改动 meta.permission').toBeNull()
    expect(
      await withRedis(redis => scanKeys(redis, permissionsCachePattern(adminUserId))),
      '只改 title 却清了 AUTH:PERMISSIONS 缓存（F3 收窄失效）',
    ).toEqual(cachedBeforeTitleUpdate)

    // 7. 列表：唯一前缀 like 只命中这两行；行里带 meta 对象
    const list = await root.root<SystemMenuListPage>('POST', `${SystemRoutes.MENU}/list`, {
      filters: [{ field: 'name', op: 'like', value: prefix }],
      page: { page: 1, pageSize: 20 },
    })
    expect(list.total).toBe(2)
    expect(Array.isArray(list.data), 'menu/list 缺 data 数组').toBe(true)
    expect(list.data).toHaveLength(2)
    const listedElement = list.data.find(row => row.id === elementId)
    expect(listedElement, 'menu/list 没有新建 element').not.toBeUndefined()
    expect(listedElement!.meta?.permission).toBe(updatedPermission)
    expect(listedElement!.pid).toBe(catalogId)

    // 8. 删除（软删 = 主行移除 + sys_deleted 快照）：列表 / 树 / 权限串三处都要消失
    const deletedElement = await root.root<SystemMenu>('DELETE', `${SystemRoutes.MENU}/${elementId}`)
    expect(deletedElement.id).toBe(elementId)
    elementId = ''

    const deletedCatalog = await root.root<SystemMenu>('DELETE', `${SystemRoutes.MENU}/${catalogId}`)
    expect(deletedCatalog.id).toBe(catalogId)
    catalogId = ''

    const afterDelete = await root.root<SystemMenuListPage>('POST', `${SystemRoutes.MENU}/list`, {
      filters: [{ field: 'name', op: 'like', value: prefix }],
      page: { page: 1, pageSize: 20 },
    })
    expect(afterDelete.total).toBe(0)
    expect(afterDelete.data).toHaveLength(0)

    const treeAfterDelete = await root.root<SystemMenuTreeResponse>('GET', SystemEndpointRoutes.MENU_TREE)
    expect(findNode(treeAfterDelete.fullTree, deletedCatalog.id)).toBeNull()
    expect(treeAfterDelete.fullTree.flatMap(node => flattenTree([node])).some(node => node.meta.permission === updatedPermission)).toBe(false)

    await withPg(async (pg) => {
      expect(await countDeletedRows(pg, deletedElement.id), 'element 删除没有写 sys_deleted 快照').toBe(1)
      expect(await countDeletedRows(pg, deletedCatalog.id), 'catalog 删除没有写 sys_deleted 快照').toBe(1)
    })
  }
  finally {
    // 失败路径也把半造的行清掉（软删端点幂等；删不存在的 id 会 40401，吞掉即可）
    for (const id of [elementId, catalogId]) {
      if (id !== '') {
        await root.root('DELETE', `${SystemRoutes.MENU}/${id}`).catch(() => {})
      }
    }
  }
})

/**
 * F1 用例①：partial update 保字段（真 PATCH）。
 *
 * 只发 `meta.permission`（permission 是 meta 子键；wire 上没有顶层 permission）：
 * - 顶层未给列（name/title/path/pid/type）必须保持原值 —— **旧实现这条必红**：
 *   ValidationPipe 的 nil→null Transform 会把未给的字符串字段写成显式 null，
 *   update 整行覆盖后 name/title 变成 null；
 * - meta 给了仍按「整体替换 + 缺省键回默认值」：order 回到 NULL、show 回到 true
 *   （这是既有 Mongo 子文档语义，不是本批改动点，此处一并钉住边界）。
 */
test('菜单：partial update 只改提供的字段（name/title 不被 null 覆盖）', async () => {
  const root = await rootClient()
  const prefix = `e2e-menu-patch-${Date.now()}-${randomBytes(2).toString('hex')}`
  let catalogId = ''

  try {
    const seedRootId = await withPg(pg => findRootMenuId(pg))
    const created = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.CATALOG,
      pid: seedRootId,
      name: `${prefix}-cat`,
      title: `${prefix}-cat-title`,
      meta: { order: 7, status: true, show: true },
    })
    catalogId = created.id

    const updated = await root.root<SystemMenu>('PUT', `${SystemRoutes.MENU}/${catalogId}`, {
      meta: { permission: `${prefix}:partial` },
    })

    // 未提供的顶层列原样保留（旧实现：name/title → null）
    expect(updated.name, 'partial update 把未提供的 name 覆盖成了 null').toBe(`${prefix}-cat`)
    expect(updated.title, 'partial update 把未提供的 title 覆盖成了 null').toBe(`${prefix}-cat-title`)
    expect(updated.pid).toBe(seedRootId)
    expect(updated.type).toBe(MenuType.CATALOG)

    // 提供的 meta 子键生效；meta 整体替换语义不变（order 回默认 NULL、show 回默认 true）
    expect(updated.meta.permission).toBe(`${prefix}:partial`)
    expect(updated.meta.order).toBeNull()
    expect(updated.meta.show).toBe(true)
  }
  finally {
    if (catalogId !== '') {
      await root.root('DELETE', `${SystemRoutes.MENU}/${catalogId}`).catch(() => {})
    }
  }
})

/**
 * F1 用例②：递归树过滤。
 *
 * 构造 catalog → menu → element 三级：`treeWithoutTypeElement` 必须**递归**剪掉 element，
 * 同时保留有命中后代的祖先路径；`fullTree` 里 element 仍在（证明过滤真的做了事）。
 * **旧实现这条必红**：easy-fns filterTree 命中父节点即整棵返回，element 作为后代幸存。
 */
test('菜单：treeWithoutTypeElement 递归剪掉 element（父命中不豁免子孙）', async () => {
  const root = await rootClient()
  const prefix = `e2e-menu-tree-${Date.now()}-${randomBytes(2).toString('hex')}`
  let catalogId = ''
  let menuId = ''
  let elementId = ''

  try {
    const seedRootId = await withPg(pg => findRootMenuId(pg))
    const catalog = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.CATALOG,
      pid: seedRootId,
      name: `${prefix}-cat`,
      title: `${prefix}-cat-title`,
      meta: { order: 5 },
    })
    catalogId = catalog.id

    const menu = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.MENU,
      pid: catalogId,
      name: `${prefix}-menu`,
      title: `${prefix}-menu-title`,
      path: `/${prefix}-menu`,
      meta: { order: 6 },
    })
    menuId = menu.id

    const element = await root.root<SystemMenu>('POST', SystemRoutes.MENU, {
      type: MenuType.ELEMENT,
      pid: menuId,
      name: `${prefix}-el`,
      meta: { permission: `${prefix}:recursive`, order: 1 },
    })
    elementId = element.id

    const tree = await root.root<SystemMenuTreeResponse>('GET', SystemEndpointRoutes.MENU_TREE)

    // 对照：fullTree 里 element 确实存在（挂在 menu 下）
    expect(flattenTree(tree.fullTree).some(node => node.id === elementId), 'fullTree 里找不到刚建的 element').toBe(true)

    const filtered = flattenTree(tree.treeWithoutTypeElement)
    // 命中的祖先路径保留：catalog 与 menu 都在
    expect(filtered.some(node => node.id === catalogId), 'treeWithoutTypeElement 丢了 catalog 祖先').toBe(true)
    expect(filtered.some(node => node.id === menuId), 'treeWithoutTypeElement 丢了 menu 节点').toBe(true)
    // element 在任何层级都不出现（旧实现：作为 menu 的后代幸存）
    expect(filtered.some(node => node.id === elementId), 'treeWithoutTypeElement 里仍残留 element 后代').toBe(false)
    expectNoElementDeep(tree.treeWithoutTypeElement)
  }
  finally {
    // 子行先删（pid FK RESTRICT）
    for (const id of [elementId, menuId, catalogId]) {
      if (id !== '') {
        await root.root('DELETE', `${SystemRoutes.MENU}/${id}`).catch(() => {})
      }
    }
  }
})
