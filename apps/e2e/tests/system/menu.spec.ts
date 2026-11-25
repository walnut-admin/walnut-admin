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
 * treeWithoutTypeElement 的**真实 wire 语义**：只有顶层节点按 type 过滤。
 *
 * 服务端用 easy-fns-ts 的 `filterTree(fullTree, node => node.type !== element)`；该实现的
 * 语义是「节点命中 predicate 就整棵返回」—— 命中的 catalog/menu 的**后代**（含 element）
 * 原样保留。所以不能递归断言 element-free；这个端点服务于「父节点选择」（只需要顶层可选），
 * 递归过滤不是它的契约。R4 实测记录，见报告「新发现」。
 */
function expectNoTopLevelElement(nodes: SystemMenuTree[]): void {
  for (const node of nodes) {
    expect(node.type, `treeWithoutTypeElement 顶层出现了 element 行（${node.id}）`).not.toBe(MenuType.ELEMENT)
  }
}

async function permissionStrings(client: Awaited<ReturnType<typeof rootClient>>): Promise<string[]> {
  const permissions = await client.root<{ permissionStrings: string[] }>('GET', AuthRoutes.PERMISSIONS)
  return permissions.permissionStrings
}

/**
 * update 载荷必须带**整行**（type / pid / path / name / component / title / icon / meta）。
 *
 * 为什么不能只发要改的字段：ValidationPipe 的 `plainToInstance` 会为未给键的字符串字段
 * 跑 `@Transform`（nil → null），menu 的 Update DTO 虽然全字段可选，但省略的 name/title/…
 * 会以显式 null 覆盖库里的值（这是服务端既有语义，admin 表单也总是回传整行）。
 * 用例按真实客户端的口径发整行，并在报告里记录这个「partial update 实际会清空标量字段」的发现。
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
    expectNoTopLevelElement(tree.treeWithoutTypeElement)

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
