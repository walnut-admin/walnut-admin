import type { INestApplication } from '@nestjs/common'
import type { IWalnutAdminMenuMeta } from '@walnut/contract/menu'
import type { DataSource } from 'typeorm'

import { randomUUID } from 'node:crypto'

import { WalnutAdminConstAppPermissionType } from '@walnut-server/const/app/permission'

import { assembleSysMenuMeta, SysMenuRepositoryService, SysMenuService, SysMenuSharedService, SysRoleBasicRepository, SysRoleRepoService, SysRoleService } from '@walnut-server/system'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B5 sys_menu / sys_role 用例（phase2 4.2/4.3 / phase3-plan §1 B5，on real PG）：
 * - meta 拍平出入参：入参 meta 对象拆 19 列（缺省键回填 schema 默认值，对齐 Mongo
 *   子文档替换语义），出参 assembleSysMenuMeta 组装回 meta 对象且逐字段保真；
 * - uq_menu_name（partial unique）同名校验；pid 自引用 FK 的 RESTRICT 语义；
 * - 菜单树：单次全量查询 + 内存建树（对照 Mongo 版口径），children/meta/order 形态不变；
 * - sys_role：menus 数组 → sys_role_menu junction（create/update 整组替换）、
 *   uq_role_name、根角色更新拦截、menusList JOIN（match meta.status=true）、
 *   findByIds 的 In(uuid[])、usersCount 计数子查询；
 * - 权限链路（getCorePermissions）：junction populate → meta 组装 → 路由/权限出参形态。
 */

/** 树节点的测试侧最小形态（断言用，不追求与全局树类型同构） */
interface ITreeNodeLike {
  id: string
  name: string | null
  title: string | null
  meta: { order: number | null, transition: string, permission: string | null }
  children?: ITreeNodeLike[]
}

function findTreeNode(nodes: ITreeNodeLike[], id: string): ITreeNodeLike | undefined {
  return nodes.find(n => n.id === id)
    ?? nodes.flatMap(n => findTreeNode(n.children ?? [], id))[0]
}

describe('B5 sys_menu / sys_role (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let menuService: SysMenuService
  let menuSharedService: SysMenuSharedService
  let menuRepoService: SysMenuRepositoryService
  let roleService: SysRoleService
  let roleRepoService: SysRoleRepoService
  let roleBasicRepo: SysRoleBasicRepository

  const uniqueName = (prefix: string) => `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8)}`

  // SysRoleDTOCreateRequest 的 Pick 侧（roleName/description/order/status）全必填（与 admin 表单一致）
  const rolePayload = (overrides: { roleName: string, description?: string, menus?: string[] }) => ({
    roleName: overrides.roleName,
    description: (overrides.description ?? null) as unknown as string,
    order: null as unknown as number,
    status: true,
    menus: overrides.menus,
  })

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    menuService = app.get(SysMenuService)
    menuSharedService = app.get(SysMenuSharedService)
    menuRepoService = app.get(SysMenuRepositoryService)
    roleService = app.get(SysRoleService)
    roleRepoService = app.get(SysRoleRepoService)
    roleBasicRepo = app.get(SysRoleBasicRepository)
  })

  afterAll(async () => {
    // 本 spec 与 API 级 spec 共享集成库：造的 b5-* 菜单/角色若不清理，残留根节点会让
    // 后续 spec 的取根结果多一根（P3-18 的顺序敏感面）。子行先删（pid FK RESTRICT）。
    await pgDataSource.query(
      'DELETE FROM sys_menu WHERE pid IS NOT NULL AND (name LIKE $1 OR path LIKE $2 OR title LIKE $3)',
      ['b5-%', '/b5-%', 'b5.%'],
    )
    await pgDataSource.query(
      'DELETE FROM sys_menu WHERE name LIKE $1 OR path LIKE $2 OR title LIKE $3',
      ['b5-%', '/b5-%', 'b5.%'],
    )
    await pgDataSource.query('DELETE FROM sys_role WHERE role_name LIKE $1', ['b5-role%'])
    await app.close()
  })

  describe('sys_menu：meta 拍平出入参', () => {
    // B5-5 create 口径统一后 type 必填（SysMenuDTOCreateRequest 的 Pick 核，对齐
    // rolePayload 的注释口径）：服务级用例载荷显式给 type —— 断言钉的 DB 默认值 /
    // 唯一约束 / FK 行为均与 type 无关，特性化测试价值不变
    it('create：meta 对象拆 19 列落库（缺省键回填 schema 默认值），id 为 uuid', async () => {
      const created = await menuService.create({
        pid: null,
        type: 'catalog',
        name: uniqueName('b5-menu'),
        meta: {
          order: 3,
          show: false,
          permission: 'b5:perm:create',
        } as IWalnutAdminMenuMeta,
      })

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      // pid 可空（根节点），显式 null 原样落库
      expect(created.pid).toBeNull()
      // 给 出的字段落拍平列
      expect(created.order).toBe(3)
      expect(created.show).toBe(false)
      expect(created.permission).toBe('b5:perm:create')
      // 未给的键回填 schema 默认值（对齐 Mongo 子文档默认值语义）
      expect(created.ternal).toBe('none')
      expect(created.cache).toBe(false)
      expect(created.status).toBe(true)
      expect(created.transition).toBe('fade')
      expect(created.cacheKeyStrategy).toBeNull()

      // 组装回 meta 对象：与入参 + 默认值逐字段保真
      const meta = assembleSysMenuMeta(created)
      expect(meta).toEqual({
        order: 3,
        ternal: 'none',
        url: null,
        show: false,
        cache: false,
        status: true,
        affix: false,
        permission: 'b5:perm:create',
        menuActiveName: null,
        menuActiveSameTab: false,
        badge: null,
        activeIcon: null,
        position: false,
        leaveTip: false,
        maskUrl: false,
        hijackRefresh: false,
        watermark: null,
        transition: 'fade',
        cacheKeyStrategy: null,
      })
    })

    it('create：meta 整体缺省 → 全列走 DB 默认值（对齐 Mongo meta 缺省）', async () => {
      const created = await menuService.create({ type: 'catalog', name: uniqueName('b5-menu') })

      expect(created.order).toBeNull()
      expect(created.ternal).toBe('none')
      expect(created.show).toBe(true)
      expect(created.transition).toBe('fade')
    })

    it('update：meta 给 出时整组替换（未给键回默认值）；meta 未给 时 meta 列不动', async () => {
      const created = await menuService.create({
        type: 'catalog',
        name: uniqueName('b5-menu'),
        meta: { order: 1, cache: true } as IWalnutAdminMenuMeta,
      })

      const updated = await menuService.update(created.id, { meta: { order: 9 } as IWalnutAdminMenuMeta })

      // 整组替换：未给的 cache 回默认 false（对齐 Mongo 版 meta 子文档整体替换）
      expect(updated.order).toBe(9)
      expect(updated.cache).toBe(false)

      // meta 未给：只动给出的列，meta 列保持
      const updatedAgain = await menuService.update(created.id, { title: 'b5-title' })
      expect(updatedAgain.title).toBe('b5-title')
      expect(updatedAgain.order).toBe(9)
    })

    it('uq_menu_name（partial unique）：同 name 第二次插入拒绝；name 为 NULL 不受约束', async () => {
      const name = uniqueName('b5-uniq')

      await menuService.create({ type: 'catalog', name })
      await expect(menuService.create({ type: 'catalog', name })).rejects.toThrow()

      // partial：name IS NULL 的行不进唯一索引，可多行
      await menuService.create({ type: 'catalog', path: '/b5-null-1' })
      await menuService.create({ type: 'catalog', path: '/b5-null-2' })
    })

    it('软删：sys_deleted 快照落 PG，行从 sys_menu 消失', async () => {
      const created = await menuService.create({ type: 'catalog', name: uniqueName('b5-del') })

      const deleted = await menuService.delete(created.id, created.id, 0)
      expect(deleted.id).toBe(created.id)

      const gone = await pgDataSource.query<Array<{ c: number }>>('SELECT count(*)::int AS c FROM sys_menu WHERE id = $1', [created.id])
      expect(gone[0].c).toBe(0)

      const snapshot = await pgDataSource.query<Array<{ c: number }>>(
        'SELECT count(*)::int AS c FROM sys_deleted WHERE model_name = $1 AND deleted_id = $2',
        ['SysMenu', created.id],
      )
      expect(snapshot[0].c).toBe(1)
    })

    it('pid 自引用 FK RESTRICT：存在子节点时删除父节点被拒（防误删静默扩面）', async () => {
      const parent = await menuService.create({ type: 'catalog', name: uniqueName('b5-parent') })
      await menuService.create({ type: 'catalog', pid: parent.id, name: uniqueName('b5-child') })

      await expect(menuService.delete(parent.id, parent.id, 0)).rejects.toThrow()
    })

    it('list：{ data, total } 出参 + 行可组装回 meta 形态', async () => {
      const name = uniqueName('b5-list')
      await menuService.create({ type: 'catalog', name, meta: { order: 5 } as IWalnutAdminMenuMeta })

      const res = await menuService.list({ query: { name } } as never)
      expect(res.total).toBe(1)
      expect(res.data[0].name).toBe(name)
      expect(res.data[0].order).toBe(5)

      const meta = assembleSysMenuMeta(res.data[0])
      expect(meta.order).toBe(5)
      expect(meta.transition).toBe('fade')
    })
  })

  describe('sys_menu：菜单树（单次全量查询 + 内存建树）', () => {
    it('children 按 meta.order 组装、meta 结构保真、ELEMENT 不进 treeWithoutTypeElement', async () => {
      // 树出口是「全部根的 children 拼接」（P3-18；单根生产形态即根下第一层），
      // 测试子树挂在任一根下都确定可达 —— 取 order 最小的根（findAllRootMenus 已排序）
      const treeRoot = (await menuRepoService.findAllRootMenus())[0]
      expect(treeRoot).toBeDefined()

      const branch = await menuService.create({
        pid: treeRoot.id,
        type: 'catalog',
        name: uniqueName('b5-tree-root'),
        meta: { order: 1 } as IWalnutAdminMenuMeta,
      })

      const menuChild = await menuService.create({
        pid: branch.id,
        type: 'menu',
        name: uniqueName('b5-tree-menu'),
        title: 'b5.tree.menu',
        meta: { order: 2 } as IWalnutAdminMenuMeta,
      })
      const elementChild = await menuService.create({
        pid: branch.id,
        type: 'element',
        name: uniqueName('b5-tree-element'),
        meta: { order: 0 } as IWalnutAdminMenuMeta,
      })
      // order 乱序插入，验证 orderTree
      const menuChild2 = await menuService.create({
        pid: branch.id,
        type: 'menu',
        name: uniqueName('b5-tree-menu2'),
        meta: { order: 1 } as IWalnutAdminMenuMeta,
      })

      const res = await menuSharedService.getMenuTreeAndTreeWithoutTypeElement()

      // 全树里按 id 定位本用例的分支（同层可能混有其他用例节点，不依赖顺序）
      const node = findTreeNode(res.fullTree ?? [], branch.id)
      expect(node).toBeDefined()

      // children 按 meta.order 升序：element(0) → menu2(1) → menu(2)
      expect(node!.children).toHaveLength(3)
      expect(node!.children!.map(c => c.id)).toEqual([
        elementChild.id,
        menuChild2.id,
        menuChild.id,
      ])
      expect(node!.children!.map(c => c.meta.order)).toEqual([0, 1, 2])

      // meta 对象在树节点上形态保真
      const menuNode = node!.children!.find(c => c.id === menuChild.id)
      expect(menuNode!.title).toBe('b5.tree.menu')
      expect(menuNode!.meta.transition).toBe('fade')

      // treeWithoutTypeElement 沿用 Mongo 版同款 easy-fns filterTree 语义：命中节点整棵
      // 保留（不深滤子孙），仅「回调为假的叶子」被剪 —— 断言钉住的是现状形态而非理想语义
      const withoutElement = JSON.stringify(res.treeWithoutTypeElement)
      expect(withoutElement).toContain(branch.id)
      expect(withoutElement).toContain(menuChild.id)

      // menuActiveNamesOptions 只收 type=menu
      const options = res.menuActiveNamesOptions.filter(i => i.title === 'b5.tree.menu')
      expect(options).toHaveLength(1)
      expect(options[0].name).toBe(menuChild.name)
    })
  })

  describe('sys_role：junction 写入与 populate', () => {
    it('create：menus 数组落 sys_role_menu 行；缺省 menus = 空数组', async () => {
      const menuA = await menuService.create({ type: 'catalog', name: uniqueName('b5-role-menu') })
      const menuB = await menuService.create({ type: 'catalog', name: uniqueName('b5-role-menu') })

      const created = await roleService.create(rolePayload({
        roleName: uniqueName('b5-role'),
        description: 'B5 int-spec',
        menus: [menuA.id, menuB.id],
      }))

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect([...created.menus].sort()).toEqual([menuA.id, menuB.id].sort())

      const junction = await pgDataSource.query<Array<{ c: number }>>(
        'SELECT count(*)::int AS c FROM sys_role_menu WHERE role_id = $1',
        [created.id],
      )
      expect(junction[0].c).toBe(2)

      const noMenus = await roleService.create(rolePayload({ roleName: uniqueName('b5-role') }))
      expect(noMenus.menus).toEqual([])
    })

    it('uq_role_name：同名角色第二次插入拒绝', async () => {
      const roleName = uniqueName('b5-role-uniq')
      await roleService.create(rolePayload({ roleName }))
      await expect(roleService.create(rolePayload({ roleName }))).rejects.toThrow()
    })

    it('update：menus 整组替换（delete+insert 同事务）；未给 menus 时不动', async () => {
      const menuA = await menuService.create({ type: 'catalog', name: uniqueName('b5-role-menu') })
      const menuB = await menuService.create({ type: 'catalog', name: uniqueName('b5-role-menu') })
      const role = await roleService.create(rolePayload({ roleName: uniqueName('b5-role'), menus: [menuA.id] }))

      const updated = await roleService.update(role.id, {
        roleName: role.roleName,
        description: null as unknown as string,
        order: null as unknown as number,
        status: true,
        menus: [menuB.id],
      })
      expect(updated.menus).toEqual([menuB.id])

      const junction = await pgDataSource.query<Array<{ menu_id: string }>>(
        'SELECT menu_id FROM sys_role_menu WHERE role_id = $1',
        [role.id],
      )
      expect(junction.map(r => r.menu_id)).toEqual([menuB.id])

      // 未给 menus：junction 原样（对齐 Mongo 逐字段赋值语义）
      const untouched = await roleService.update(role.id, {
        roleName: role.roleName,
        description: 'still here',
        order: null as unknown as number,
        status: true,
      })
      expect(untouched.description).toBe('still here')
      expect(untouched.menus).toBeUndefined()

      const stillOne = await pgDataSource.query<Array<{ c: number }>>(
        'SELECT count(*)::int AS c FROM sys_role_menu WHERE role_id = $1',
        [role.id],
      )
      expect(stillOne[0].c).toBe(1)
    })

    it('read：usersCount 计数子查询 + menus 读出', async () => {
      const role = await roleBasicRepo.create({ roleName: uniqueName('b5-role') })

      const read = await roleService.read(role.id)
      // B5~B7 残留窗口：user 侧未迁，junction 恒空 → 计数 0（见 phase3-plan §5）
      expect(read.usersCount).toBe(0)
      expect(read.menus).toEqual([])

      await expect(roleService.read(randomUUID())).rejects.toThrow()
    })

    it('根角色保护：更新 root 角色被拒（PG 侧按角色名等价判据）', async () => {
      // seed 层自带 root 角色（role_name 全库唯一），不能裸插同名行 —— 幂等复用已有行
      // （与 auth-login.registerRootUserFixture 同款 upsert 语义），断言仍钉 PG 侧根角色判据。
      const rootRows: Array<{ id: string }> = await pgDataSource.query(
        `WITH ins AS (
           INSERT INTO sys_role (role_name) VALUES ('root')
           ON CONFLICT (role_name) DO NOTHING
           RETURNING id
         )
         SELECT id FROM ins
         UNION ALL
         SELECT id FROM sys_role WHERE role_name = 'root'
         LIMIT 1`,
      )
      await expect(roleService.update(rootRows[0].id, {
        roleName: 'root',
        description: 'x',
        order: null as unknown as number,
        status: true,
      })).rejects.toThrow()
    })

    it('findByIds：In(uuid[]) 批查', async () => {
      const a = await roleBasicRepo.create({ roleName: uniqueName('b5-role') })
      const b = await roleBasicRepo.create({ roleName: uniqueName('b5-role') })

      const found = await roleRepoService.findByIds([a.id, b.id])
      expect(found.map(i => i.id).sort()).toEqual([a.id, b.id].sort())
    })

    it('menusList：junction JOIN 组装 + match meta.status=true + meta 对象保真', async () => {
      const visible = await menuService.create({
        type: 'catalog',
        name: uniqueName('b5-pop'),
        meta: { order: 2, permission: 'b5:pop:read' } as IWalnutAdminMenuMeta,
      })
      const hidden = await menuService.create({
        type: 'catalog',
        name: uniqueName('b5-pop'),
        meta: { status: false } as IWalnutAdminMenuMeta,
      })

      const role = await roleService.create(rolePayload({
        roleName: uniqueName('b5-role'),
        menus: [visible.id, hidden.id],
      }))

      const roles = await roleRepoService.findRolesWithPopulatedMenus([role.id])

      expect(roles).toHaveLength(1)
      expect(roles[0].roleName).toBe(role.roleName)
      expect(roles[0].menus.sort()).toEqual([visible.id, hidden.id].sort())

      // match { 'meta.status': true } → status=false 的菜单不进 populate
      expect(roles[0].menusList).toHaveLength(1)
      const menu = roles[0].menusList[0]
      expect(menu.id).toBe(visible.id)
      // meta 组装回对象且逐字段保真
      expect(menu.meta.permission).toBe('b5:pop:read')
      expect(menu.meta.order).toBe(2)
      expect(menu.meta.transition).toBe('fade')
    })

    it('list：usersCount 并回列表行（Mongo 版 $lookup/$size 出参字段）', async () => {
      const roleName = uniqueName('b5-role-list')
      await roleService.create(rolePayload({ roleName }))

      const res = await roleService.list({ query: { roleName } } as never)
      expect(res.total).toBe(1)
      expect(res.data[0].usersCount).toBe(0)
    })
  })

  describe('权限链路：getCorePermissions（junction populate → meta 组装 → 出参形态）', () => {
    it('permissionStrings / keepAliveNames / affixedTabs / internalIframeList / 路由 meta 形态', async () => {
      // 权限树出口是「全部根的 children 拼接」（P3-18）—— permMenu 挂在任一根下都确定可达
      const treeRoot = (await menuRepoService.findAllRootMenus())[0]
      expect(treeRoot).toBeDefined()

      const permMenu = await menuService.create({
        pid: treeRoot.id,
        type: 'menu',
        name: uniqueName('b5-perm'),
        meta: {
          order: 1,
          permission: 'b5:core:read',
          cache: true,
          affix: true,
          ternal: 'internal',
          url: 'https://b5.example.com',
        } as IWalnutAdminMenuMeta,
      })

      const role = await roleService.create(rolePayload({
        roleName: uniqueName('b5-role-core'),
        menus: [permMenu.id],
      }))

      const user = {
        userId: randomUUID(),
        roleIds: [role.id],
        currentRole: role.id,
      } as IWalnutAdminAccessTokenPayload

      // P1-18 根修（F1）：权限计算按 sys_user_role 实时 membership 过滤 payload ——
      // 这里必须落真实 junction 行，否则角色的菜单会被当成「已移出」滤掉。
      await pgDataSource.query(
        `INSERT INTO sys_user (id, user_name, role_mode, current_role_id) VALUES ($1, $2, 'combinable', $3)`,
        [user.userId, uniqueName('b5-perm-user'), role.id],
      )
      await pgDataSource.query(
        'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
        [user.userId, role.id],
      )

      try {
        const res = await menuSharedService.getCorePermissions(user, WalnutAdminConstAppPermissionType.ALL)

        expect(res.permissionStrings).toContain('b5:core:read')
        expect(res.keepAliveNames).toContain(permMenu.name)
        expect(res.affixedTabs.map(i => i.name)).toContain(permMenu.name)
        expect(res.internalIframeList).toEqual([
          { name: permMenu.name, url: 'https://b5.example.com', cache: true },
        ])

        // 路由树节点 meta 形态（拍平列组装 + title/type/icon 并入 meta）
        const routeNode = JSON.stringify(res.permissionRouteTree)
        expect(routeNode).toContain(permMenu.name)
        expect(routeNode).toContain('"ternal":"internal"')
      }
      finally {
        await pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [user.userId])
      }
    })
  })
})
