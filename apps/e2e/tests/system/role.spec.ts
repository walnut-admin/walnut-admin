/**
 * 模块 spec ②：角色（CRUD / 授权回收 / 与用户的权限生效链）。
 *
 * 服务端真源（写断言前已对照）：
 * - **list 行不含 menus / deptIds**（`SysRoleDTOListResponse` = RealPartialType(SysRoleDTOSafeWithoutMenus)），
 *   关联数据只在**详情端点** `GET /system/role/:id` 里（`findByIdWithUsersCount` 并回
 *   junction 读出的 menus / deptIds + usersCount）。这就是 R2 时发现的「别在 list 行上断言关联」；
 * - create/update 的 menus / deptIds 走 `sys_role_menu` / `sys_role_dept` junction，update 时
 *   `menus` 未给不动、给了整组替换（`role.basic.repository.ts`）；
 * - 角色授权/停用 → `findUserIdsByRoleId` 反查成员，提交后 `delPermissionsForUser`
 *   （`AUTH:PERMISSIONS:<userId>:*`）—— 用户下次 `/auth/permissions` 按新授权重算（P2-16）；
 * - 用户角色整组替换 → 同一把缓存失效（`user.crud.service.update`）；
 * - **没有 delete 端点**（controller 只有 create/read/update/list；角色删除不在当前 API 面）。
 *
 * 用户怎么来的：`POST /system/user` 建号不带口令；E2E 用 `lib/account-fixtures.ts` 的
 * OPAQUE 注册链补一份 password identity，然后**真实协议登录**（见该文件头注释）。
 */
import type { SystemRole, SystemUser } from '@walnut/api-types'
import type { SystemRoleListPage } from '../../lib/protocol/api-types.ts'
import {
  createLoginableUser,
  deleteLoginableUser,
  loginAs,
  uniqueUserName,
} from '../../lib/account-fixtures.ts'
import {
  deleteRoleById,
  deleteUserByUserName,
  findElementMenuIdByPermission,
  findRoleIdByName,
  withPg,
} from '../../lib/pg.ts'
import { AuthRoutes, SystemRoutes } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { permissionsCachePattern, scanKeys, withRedis } from '../../lib/redis.ts'
import { expect, test } from '../fixtures.ts'

/** seed 里带授权的非 root 角色（test-home 有 1 条 menu junction；visitor 的权限走角色名短路） */
const SEED_ROLE_WITH_MENUS = 'test-home'

/** 三个稳定权限串（seed 的 element 菜单；A/B 用于授权整组替换，C 用于用户换角色） */
const PERM_A = 'system:user:create'
const PERM_B = 'system:role:create'
const PERM_C = 'system:dict:type:create'

async function permissionStrings(
  client: Awaited<ReturnType<typeof rootClient>>,
): Promise<string[]> {
  const permissions = await client.root<{ permissionStrings: string[] }>(
    'GET',
    AuthRoutes.PERMISSIONS,
  )
  return permissions.permissionStrings
}

async function newRole(
  root: Awaited<ReturnType<typeof rootClient>>,
  name: string,
  menus: string[],
): Promise<SystemRole> {
  return root.root<SystemRole>('POST', SystemRoutes.ROLE, {
    roleName: name,
    description: `${name} description`,
    order: 100,
    status: true,
    menus,
  })
}

test(
  '角色：list 行不带关联、详情端点带 menus/deptIds；授权回收与 usersCount 同步',
  { tag: '@smoke' },
  async () => {
    const root = await rootClient()
    const roleName = uniqueUserName('e2e-role')
    let roleId = ''
    let userName = ''

    try {
      // 1. list 行：关联字段**不在**（R2 对照点）；usersCount 在
      const list = await root.root<SystemRoleListPage>('POST', `${SystemRoutes.ROLE}/list`, {
        filters: [{ field: 'roleName', op: 'eq', value: SEED_ROLE_WITH_MENUS }],
        page: { page: 1, pageSize: 20 },
      })
      expect(list.total).toBe(1)
      expect(list.data).toHaveLength(1)
      const listRow = list.data[0]!
      expect(listRow.roleName).toBe(SEED_ROLE_WITH_MENUS)
      expect(typeof listRow.usersCount, 'role/list 行缺 usersCount').toBe('number')
      expect('menus' in listRow, 'role/list 行不应带 menus（详情端点才是关联数据源）').toBe(false)
      expect('deptIds' in listRow, 'role/list 行不应带 deptIds').toBe(false)

      // 2. 详情端点：menus / deptIds / usersCount 三件套都在
      const seedRoleId = await withPg((pg) => findRoleIdByName(pg, SEED_ROLE_WITH_MENUS))
      const seedDetail = await root.root<SystemRole>('GET', `${SystemRoutes.ROLE}/${seedRoleId}`)
      expect(seedDetail.roleName).toBe(SEED_ROLE_WITH_MENUS)
      expect(Array.isArray(seedDetail.menus), 'role 详情缺 menus 数组').toBe(true)
      expect(seedDetail.menus.length, `${SEED_ROLE_WITH_MENUS} 在 seed 里应有 1 条菜单授权`).toBe(1)
      expect(Array.isArray(seedDetail.deptIds), 'role 详情缺 deptIds 数组').toBe(true)
      expect(typeof seedDetail.usersCount).toBe('number')

      // 3. 建角色（挂 seed 的 element 菜单 PERM_A）→ 详情回读
      const menuA = await withPg((pg) => findElementMenuIdByPermission(pg, PERM_A))
      const menuB = await withPg((pg) => findElementMenuIdByPermission(pg, PERM_B))
      const created = await newRole(root, roleName, [menuA])
      roleId = created.id
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(created.menus).toEqual([menuA])

      const detailAfterCreate = await root.root<SystemRole>('GET', `${SystemRoutes.ROLE}/${roleId}`)
      expect(detailAfterCreate.menus).toEqual([menuA])
      expect(detailAfterCreate.deptIds).toEqual([])
      expect(detailAfterCreate.usersCount).toBe(0)

      // 4. 授权整组替换（A → B）：旧授权被回收、新授权生效
      const updated = await root.root<SystemRole>('PUT', `${SystemRoutes.ROLE}/${roleId}`, {
        roleName,
        description: `${roleName} updated`,
        order: 101,
        status: true,
        menus: [menuB],
      })
      expect(updated.menus).toEqual([menuB])

      const detailAfterUpdate = await root.root<SystemRole>('GET', `${SystemRoutes.ROLE}/${roleId}`)
      expect(detailAfterUpdate.menus, '角色授权没有整组替换为 B').toEqual([menuB])
      expect(detailAfterUpdate.description).toBe(`${roleName} updated`)
      expect(detailAfterUpdate.order).toBe(101)

      // 5. 与用户关联：建号挂角色 → 角色详情 usersCount 同步 + 用户详情 roles 直断言
      userName = uniqueUserName('e2e-role-user')
      const user = await root.root<SystemUser>('POST', SystemRoutes.USER, {
        userName,
        status: true,
        roles: [roleId],
      })
      expect(user.roles ?? []).toContain(roleId)

      const detailWithUser = await root.root<SystemRole>('GET', `${SystemRoutes.ROLE}/${roleId}`)
      expect(detailWithUser.usersCount, '角色挂上用户后 usersCount 仍为 0').toBe(1)

      // ③（2026-11）：用户详情响应直出 roles（uuid 数组，与 roles_list 同源）——
      // 关联证据不再需要绕道角色详情的 usersCount（两条断言都留：各有各的语义）。
      const userDetail = await root.root<SystemUser>('GET', `${SystemRoutes.USER}/${user.id}`)
      expect(userDetail.userName).toBe(userName)
      expect(userDetail.roles, '用户详情缺 roles（角色关联直断言）').toEqual([roleId])
      expect(
        userDetail.roles_list?.map((row) => row.id),
        '用户详情 roles_list 与 roles 不同源',
      ).toEqual([roleId])
    } finally {
      if (userName !== '') {
        await withPg((pg) => deleteUserByUserName(pg, userName)).catch(() => {})
      }
      if (roleId !== '') {
        await withPg((pg) => deleteRoleById(pg, roleId)).catch(() => {})
      }
    }
  },
)

test(
  '角色授权变化 → 用户权限串变化：缓存失效 + /auth/permissions 重算 + 用户换角色',
  { tag: '@smoke' },
  async () => {
    const root = await rootClient()
    const roleName = uniqueUserName('e2e-role-perm')
    const role2Name = uniqueUserName('e2e-role-perm2')
    let roleId = ''
    let role2Id = ''
    let user: Awaited<ReturnType<typeof createLoginableUser>> | null = null

    try {
      const menuA = await withPg((pg) => findElementMenuIdByPermission(pg, PERM_A))
      const menuB = await withPg((pg) => findElementMenuIdByPermission(pg, PERM_B))
      const menuC = await withPg((pg) => findElementMenuIdByPermission(pg, PERM_C))

      const role = await newRole(root, roleName, [menuA])
      roleId = role.id
      const role2 = await newRole(root, role2Name, [menuC])
      role2Id = role2.id

      // 非 root 用户：真实 OPAQUE 登录 → 绑定 TOTP（把 mfa_setup 置 true，才能过 MFA guard）
      const createdUser = await createLoginableUser(root, {
        userNamePrefix: 'e2e-role-perm-user',
        roleId,
      })
      user = createdUser
      const userClient = await loginAs(createdUser)
      await userClient.bindTotp()

      // 初始授权：只有 A
      const before = await permissionStrings(userClient)
      expect(before, `初始角色应授予 ${PERM_A}`).toContain(PERM_A)
      expect(before, `初始角色不应授予 ${PERM_B}`).not.toContain(PERM_B)
      expect(before, `初始角色不应授予 ${PERM_C}`).not.toContain(PERM_C)

      // 权限缓存由 /auth/permissions 写入（不是 fixture 伪造的键）
      const cachedBefore = await withRedis((redis) =>
        scanKeys(redis, permissionsCachePattern(createdUser.userId)),
      )
      expect(cachedBefore.length, '/auth/permissions 没有写该用户的权限缓存').toBeGreaterThan(0)

      // 角色授权整组替换 A → B：服务端按 sys_user_role 反查成员清缓存
      await root.root<SystemRole>('PUT', `${SystemRoutes.ROLE}/${roleId}`, {
        roleName,
        description: `${roleName} updated`,
        order: 100,
        status: true,
        menus: [menuB],
      })
      expect(
        await withRedis((redis) => scanKeys(redis, permissionsCachePattern(createdUser.userId))),
        '角色授权变化后用户的 AUTH:PERMISSIONS 缓存没有被清',
      ).toEqual([])

      const afterRoleUpdate = await permissionStrings(userClient)
      expect(afterRoleUpdate, '角色改授 B 后权限串没有变化').toContain(PERM_B)
      expect(afterRoleUpdate, '角色改授 B 后旧权限串 A 仍然存在').not.toContain(PERM_A)

      // 用户角色整组替换（role1 → role2）：同一失效通道 + 权限串换成 C
      await root.root<SystemUser>('PUT', `${SystemRoutes.USER}/${createdUser.userId}`, {
        userName: createdUser.userName,
        status: true,
        roles: [role2Id],
      })
      expect(
        await withRedis((redis) => scanKeys(redis, permissionsCachePattern(createdUser.userId))),
        '用户角色整组替换后 AUTH:PERMISSIONS 缓存没有被清',
      ).toEqual([])

      const afterUserUpdate = await permissionStrings(userClient)
      expect(afterUserUpdate, '用户换到 role2 后权限串应含 C').toContain(PERM_C)
      expect(afterUserUpdate, '用户换到 role2 后不应再有 role1 的 B').not.toContain(PERM_B)
    } finally {
      if (user !== null) {
        await deleteLoginableUser(user).catch(() => {})
      }
      for (const id of [role2Id, roleId]) {
        if (id !== '') {
          await withPg((pg) => deleteRoleById(pg, id)).catch(() => {})
        }
      }
    }
  },
)
