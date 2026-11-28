import { deleteLoginableUser } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import {
  deleteRoleById,
  findElementMenuIdByPermission,
  findMenuIdByName,
  findMenuIdByPath,
  withPg,
} from '../../lib/pg.ts'
import {
  AuthRoutes,
  SystemEndpointRoutes,
  SystemRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { readPermissionsCache, withRedis } from '../../lib/redis.ts'
import { captureEnvelopes, loginViaUI, navigateInApp, navigateToRoute } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { createJourneyUser } from './journey-support.ts'

/**
 * J8 角色切换：页头下拉切 currentRole → 菜单 / 权限串 / 界面同趟换掉。
 *
 * 服务端真源（写断言前已对照）：
 * - `PATCH /system/user/me/role/switch/:roleId` 只更新 `sys_user.current_role_id` 并失效
 *   **数据权限**缓存（`data-scope` 的 `invalidateForUser`）；`getCoreMenus` 的 SWITCH 分支
 *   读 **AT payload 里的 currentRole** —— 所以权限串要等下一次签发 AT 才变；
 * - 前端 `ExecuteAfterSwitchRole` 的链路正是：`destroySocket` → `POST /auth/refresh`（新 AT）
 *   → 重挂根路由 → `getProfile` → `AppCoreFn1`（`/auth/permissions` 重算）→ `goIndex()`；
 * - `permission.guard` 只认 `AUTH:PERMISSIONS:<userId>:<deviceId>` 缓存 —— 界面可见性跟着
 *   `/auth/permissions` 的重算走，缓存被覆盖成新角色的权限串（旧串必须消失）。
 *
 * 角色设计（两个都带 `system:dept:list`：让用户/角色页的部门树照常加载，J8 只测角色切换；
 * 缺该权限时 `useDeptTree` 已降级为空树、不再触发致命遮罩 —— 那条链路由
 * permission-visibility.spec.ts 的 J7b 单独覆盖）：
 * - A：`User` 菜单 + `system:user:list` → 登录后落在 /system/user，表格能出数据；
 * - B：`Role` 菜单 + `system:role:list` → 切换后落在 /system/role，且 `role-create-btn` 隐藏
 *   （没有 `system:role:create`）。
 *
 * 断言分三层：协议（两次 `/auth/permissions` 的权限串翻转）、缓存（本设备缓存被覆盖）、
 * 界面（路由 / 侧边栏 / 按钮 / 旧路由 404）。
 */

const ROLE_A_PERMISSION = 'system:user:list'
const ROLE_B_PERMISSION = 'system:role:list'

interface PermissionsPayload {
  permissionStrings: string[]
}

interface ServerEnvelope<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
}

/** 重签 AT 并读 `/auth/permissions`（AT payload 里的 currentRole 会在 refresh 时刷新） */
async function permissionsAfterRefresh(
  client: Awaited<ReturnType<typeof rootClient>>,
): Promise<string[]> {
  const refreshed = await client.request<{ accessToken: string }>('POST', AuthRoutes.REFRESH)
  const accessToken = refreshed.data.accessToken
  // requestFree 返回**原始响应壳**（不剥 data），与 request 的差异见 protocol/client.ts
  const envelope = await client.requestFree<{ data: PermissionsPayload }>(
    'GET',
    AuthRoutes.PERMISSIONS,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  return envelope.data.permissionStrings
}

test.describe('角色切换 journey', { tag: '@journey' }, () => {
  test('J8 页头下拉切角色 → 权限串翻转 + 缓存覆盖 + 菜单/按钮随角色变化', async ({ browser }) => {
    const root = await rootClient()
    const suffix = `${Date.now()}`
    const roleAName = `e2e-switch-a-${suffix}`
    const roleBName = `e2e-switch-b-${suffix}`
    let roleAId = ''
    let roleBId = ''

    try {
      // 1. 两个角色：A=User+user:list，B=Role+role:list（都带 dept:list）
      const ids = await withPg(async (pg) => {
        return {
          systemCatalog: await findMenuIdByPath(pg, 'system', 'catalog'),
          userMenu: await findMenuIdByName(pg, 'User', 'menu'),
          roleMenu: await findMenuIdByName(pg, 'Role', 'menu'),
          deptList: await findElementMenuIdByPermission(pg, 'system:dept:list'),
          userList: await findElementMenuIdByPermission(pg, ROLE_A_PERMISSION),
          roleList: await findElementMenuIdByPermission(pg, ROLE_B_PERMISSION),
        }
      })

      const roleA = await root.root<{ id: string }>('POST', SystemRoutes.ROLE, {
        roleName: roleAName,
        description: `${roleAName} description`,
        order: 100,
        status: true,
        menus: [ids.systemCatalog, ids.userMenu, ids.userList, ids.deptList],
      })
      roleAId = roleA.id
      const roleB = await root.root<{ id: string }>('POST', SystemRoutes.ROLE, {
        roleName: roleBName,
        description: `${roleBName} description`,
        order: 101,
        status: true,
        menus: [ids.systemCatalog, ids.roleMenu, ids.roleList, ids.deptList],
      })
      roleBId = roleB.id

      // 2. 双角色账号：建号（A）→ 补 B → 把 currentRole 钉到 A
      const { user, totpSecret, client } = await createJourneyUser(root, 'e2e-switch', {
        roleId: roleAId,
        bindTotp: true,
      })
      await root.root('PUT', `${SystemRoutes.USER}/${user.userId}`, {
        userName: user.userName,
        status: true,
        roles: [roleAId, roleBId],
      })
      await client.root('PATCH', `${SystemEndpointRoutes.USER_ME_SWITCH_ROLE}/${roleAId}`)

      // 协议侧「切换前」：A 的权限串在、B 的不在
      const beforePermissions = await permissionsAfterRefresh(client)
      expect(beforePermissions, `切换前应含 ${ROLE_A_PERMISSION}`).toContain(ROLE_A_PERMISSION)
      expect(beforePermissions, `切换前不应含 ${ROLE_B_PERMISSION}`).not.toContain(
        ROLE_B_PERMISSION,
      )

      const session = await openDevice(browser, '/auth')
      const page = session.page
      const captured = captureEnvelopes(page)

      try {
        await loginViaUI(page, {
          userName: user.userName,
          password: user.password,
          totpSecret: totpSecret!,
        })
        session.deviceId = await resolveDeviceId(page)
        trackDevice(session.deviceId)

        // 3. 切换前界面：index menu = User（A 的菜单），表格可读
        await navigateToRoute(page, '/system/user', 'User')
        await expect(page.getByTestId('user-list-table'), 'A 角色下用户表应挂载').toBeVisible({
          timeout: 30_000,
        })
        await expect(
          page.locator('[data-testid="sidebar-menu-item"]').filter({ hasText: '用户管理' }).first(),
          '侧边栏应有用户管理',
        ).toBeVisible({ timeout: 15_000 })
        await expect(
          page.locator('[data-testid="sidebar-menu-item"]').filter({ hasText: '角色管理' }),
          'A 角色不应有角色管理菜单',
        ).toHaveCount(0)

        // 4. 页头下拉 → 切换角色 → 选 B → 确认
        await page.getByTestId('header-user-dropdown').hover()
        await page.getByTestId('header-switch-role-item').click({ timeout: 10_000 })
        const switchModal = page.getByTestId('role-switch-modal')
        await expect(switchModal, '角色切换弹窗没有打开').toBeVisible({ timeout: 15_000 })

        const permissionsAfterSwitch = page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url().endsWith(`/api${AuthRoutes.PERMISSIONS}`),
        )

        // NModal 把内容 teleport 到 body，testid 容器只包住 WForm 的挂载点 —— 单选在
        // 全局 DOM 里按 w-radio 选项点（本仓 naive-ui 的类前缀是 `w-`：w-radio / w-modal /
        // w-button）。label 文本 = 角色名（唯一生成值，不会与中文文案撞）。
        await page
          .locator('.w-radio')
          .filter({ hasText: roleBName })
          .first()
          .click({ timeout: 10_000 })
        // 表单弹窗与随后的 confirm 都用 naive 的「确定」（app.base.yes）；页面上有实时图表，
        // 按钮会一直被判 element is not stable —— 对同一个 DOM 目标派发原生 click。
        const confirmButtons = page.getByRole('button', { name: '确定', exact: true })
        await confirmButtons.last().evaluate((element) => {
          ;(element as HTMLElement).click()
        })
        // 第二步确认：dialog.warning 的内容点名目标角色（等它出现再点，避免点到正在关闭的弹窗）
        await expect(page.getByText(`确定要切换到角色${roleBName}吗？`)).toBeVisible({
          timeout: 15_000,
        })
        await confirmButtons.last().evaluate((element) => {
          ;(element as HTMLElement).click()
        })

        // 5. `/auth/permissions` 重算：权限串翻转
        const permissionEnvelope = (await (
          await permissionsAfterSwitch
        ).json()) as ServerEnvelope<PermissionsPayload>
        expect(permissionEnvelope.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        expect(
          permissionEnvelope.data.permissionStrings,
          `切换后应含 ${ROLE_B_PERMISSION}`,
        ).toContain(ROLE_B_PERMISSION)
        expect(
          permissionEnvelope.data.permissionStrings,
          `切换后不应再有 ${ROLE_A_PERMISSION}`,
        ).not.toContain(ROLE_A_PERMISSION)

        // 6. 本设备权限缓存被覆盖成新角色的串（permission.guard 只认这份缓存）
        await expect
          .poll(
            async () =>
              withRedis((redis) => readPermissionsCache(redis, user.userId, session.deviceId)),
            {
              timeout: 15_000,
              message: '切换角色后本设备的 AUTH:PERMISSIONS 缓存没有覆盖成新角色',
            },
          )
          .toEqual(expect.arrayContaining([ROLE_B_PERMISSION]))
        const cached = await withRedis((redis) =>
          readPermissionsCache(redis, user.userId, session.deviceId),
        )
        expect(cached, '旧角色的权限串仍留在本设备缓存里').not.toContain(ROLE_A_PERMISSION)

        // 7. 界面：落在 Role 页（index menu = B 的菜单），create 按钮随权限隐藏，旧菜单消失
        await page.waitForURL((url) => url.pathname === '/system/role', { timeout: 30_000 })
        await expect(page.getByTestId('role-list-table'), 'B 角色下角色表应挂载').toBeVisible({
          timeout: 30_000,
        })
        await expect(
          page.getByTestId('role-create-btn'),
          '没有 system:role:create 时创建按钮应隐藏',
        ).toHaveCount(0)
        await expect(
          page.locator('[data-testid="sidebar-menu-item"]').filter({ hasText: '用户管理' }),
          '切换后用户管理菜单应消失',
        ).toHaveCount(0)

        // 8. 旧路由不再注册：应用内导航到 /system/user → 404（不是静默空白）
        await navigateInApp(page, '/system/user')
        await expect(
          page.getByRole('heading', { name: /^404/ }),
          '切换角色后 /system/user 应落到 404（路由已注销）',
        ).toBeVisible({ timeout: 20_000 })

        // 9. 协议侧「切换后」：同一用户重签 AT 后权限串也翻转（服务端语义，不只浏览器）
        const afterPermissions = await permissionsAfterRefresh(client)
        expect(afterPermissions, `切换后协议侧应含 ${ROLE_B_PERMISSION}`).toContain(
          ROLE_B_PERMISSION,
        )
        expect(afterPermissions, `切换后协议侧不应再有 ${ROLE_A_PERMISSION}`).not.toContain(
          ROLE_A_PERMISSION,
        )
      } finally {
        captured.stop()
        await session.context.close()
        await deleteLoginableUser(user)
      }
    } finally {
      for (const id of [roleBId, roleAId]) {
        if (id !== '') {
          await withPg((pg) => deleteRoleById(pg, id)).catch(() => {})
        }
      }
    }
  })
})
