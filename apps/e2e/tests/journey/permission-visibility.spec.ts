import { deleteLoginableUser, loginAs } from '../../lib/account-fixtures.ts'
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
  SystemRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import {
  captureEnvelopes,
  expectSidebarRendered,
  loginViaUI,
  navigateToRoute,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { createJourneyUser } from './journey-support.ts'

/**
 * J7 权限可见性：**菜单给、element 不给**的非 root 角色。
 *
 * 这是调研报告 §2.5 的「权限边界」缺口：此前所有 UI 用例都是 root（permission.guard 短路），
 * 非 root 只在 role.spec 里验过「权限串集合」，没人验过**界面是否真的按权限串裁剪**。
 *
 * 形态（E1 已给 user / role 表与按钮加 testid）：
 * - 角色只挂 `system` catalog + `User` menu 两行 + `system:dept:list` 一个 element ——
 *   `/auth/permissions` 会把 `/system/user` 路由注册出来（菜单树），但**没有任何**
 *   `system:user:*` element 权限串；
 * - 进页后 `useTableAPI` 的 list 门禁（`useTableAPI.ts:42`）直接报「无权限」，**不发** list 请求；
 *   表头 create 按钮经 `WButton` 的 `auth` prop 整个不渲染（v-if）；
 * - 对照 root：同页同表，list 20000、行内按钮与 create 按钮齐全。
 *
 * 为什么额外授予 `system:dept:list`：用户页会拉 `/system/dept/tree`（`useDeptTree`，用户
 * 表单的部门选择器要用）。主用例授予它是为了把「user 模块的 element 权限是否裁剪界面」与
 * 「dept 辅助依赖的降级」两件事隔离开 —— 后者由下方的 J7b 单独覆盖（2026-11-28 已从
 * 「40105 未接线 → 全屏致命遮罩」的已知缺陷修成「空树降级 + 页面可用」）。
 *
 * 协议侧与 UI 侧都断言：`/auth/permissions` 的 `permissionStrings` 差异（协议）+ 页面真实
 * 裁剪（浏览器）—— 两层缺一不可（UI 隐藏不等于服务端授权，服务端权限串也不等于界面一定
 * 按它渲染）。
 */

const NO_AUTHORITY_TEXT = '暂无权限，请联系管理员！'

/** 路由树里收集 name（`permissionRouteTree` 是「根 → children」拼出来的嵌套树） */
function collectRouteNames(nodes: unknown, out: string[] = []): string[] {
  if (!Array.isArray(nodes)) {
    return out
  }
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) {
      continue
    }
    const record = node as Record<string, unknown>
    if (typeof record.name === 'string' && record.name !== '') {
      out.push(record.name)
    }
    collectRouteNames(record.children, out)
  }
  return out
}

interface PermissionsPayload {
  permissionStrings: string[]
  permissionRouteTree: unknown
}

/** 用该用户自己的凭据开一台协议客户端读 `/auth/permissions`（独立于浏览器设备） */
async function permissionsAs(
  user: { userName: string; password: string },
  totpSecret: string,
): Promise<PermissionsPayload> {
  const client = await loginAs(user)
  await client.verifyTotpForDevice(totpSecret)
  return await client.root<PermissionsPayload>('GET', AuthRoutes.PERMISSIONS)
}

test.describe('权限可见性 journey', { tag: '@journey' }, () => {
  test('J7 菜单给 / element 不给：表格空 + 按钮隐藏 + list 门禁；对照 root 全量可见', async ({
    browser,
    authedPage,
  }) => {
    const root = await rootClient()
    const roleName = `e2e-visibility-${Date.now()}`
    let roleId = ''

    try {
      // 1. 造角色：只给 system catalog + User menu + dept:list（没有任何 user element 行）
      const [systemCatalogId, userMenuId, deptListId] = await withPg(async (pg) => {
        return [
          await findMenuIdByPath(pg, 'system', 'catalog'),
          await findMenuIdByName(pg, 'User', 'menu'),
          await findElementMenuIdByPermission(pg, 'system:dept:list'),
        ] as const
      })
      const role = await root.root<{ id: string }>('POST', SystemRoutes.ROLE, {
        roleName,
        description: `${roleName} description`,
        order: 100,
        status: true,
        menus: [systemCatalogId, userMenuId, deptListId],
      })
      roleId = role.id

      const { user, totpSecret } = await createJourneyUser(root, 'e2e-visibility', {
        roleId,
        bindTotp: true,
      })

      try {
        // 2. 协议侧：菜单在（路由树有 User）、user 权限串不在
        const ownPermissions = await permissionsAs(user, totpSecret!)
        expect(ownPermissions.permissionStrings, 'dept:list 是页面依赖的辅助权限，应在').toContain(
          'system:dept:list',
        )
        const ownUserPermissions = ownPermissions.permissionStrings.filter((item) =>
          item.startsWith('system:user:'),
        )
        expect(
          ownUserPermissions,
          `非 root 角色不应有任何 system:user:* 权限串（实际 ${ownUserPermissions.join(', ')}）`,
        ).toEqual([])
        expect(
          collectRouteNames(ownPermissions.permissionRouteTree),
          '菜单已授权，路由树里应有 User',
        ).toContain('User')

        // root 对照：权限串全量（root 短路取全部菜单）
        const rootPermissions = await root.root<PermissionsPayload>('GET', AuthRoutes.PERMISSIONS)
        for (const permission of [
          'system:user:list',
          'system:user:create',
          'system:user:read',
          'system:user:delete',
        ]) {
          expect(rootPermissions.permissionStrings, `root 权限串应含 ${permission}`).toContain(
            permission,
          )
        }
        expect(collectRouteNames(rootPermissions.permissionRouteTree)).toContain('User')

        // 3. 非 root UI：登录后落在 User 页（index menu）；表头/表体按权限裁剪，list 请求不发出
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

          await expect(page.getByTestId('user-list-table'), '菜单已授权，表格应挂载').toBeVisible({
            timeout: 30_000,
          })

          // 手动触发一次 list（点击查询）：门禁应当拦在发请求之前，并弹无权限通知
          await page.getByTestId('table-query-search').click()
          await expect(
            page.getByText(NO_AUTHORITY_TEXT).first(),
            '没有 list 权限时应提示无权限（而不是静默空表）',
          ).toBeVisible({ timeout: 15_000 })

          const listEntry = captured.entries.find((entry) =>
            entry.url.includes(`${SystemRoutes.USER}/list`),
          )
          expect(
            listEntry,
            `没有 system:user:list 时不该发出 list 请求（实际 ${listEntry?.url ?? '未发出'}）`,
          ).toBeUndefined()

          // 表头 create（auths.create 未授予）与行内按钮都不渲染
          await expect(
            page.getByTestId('user-create-btn'),
            '无 create 权限时表头按钮不应渲染',
          ).toHaveCount(0)
          await expect(
            page.locator('tbody tr').filter({ hasText: 'admin' }),
            '无 list 权限时表格不应有数据行',
          ).toHaveCount(0)
        } finally {
          captured.stop()
          await session.context.close()
        }

        // 4. 对照 root：同页同表全量可见（worker 级共享登录 context，不额外付出一次 UI 登录）
        const rootCaptured = captureEnvelopes(authedPage)
        try {
          await authedPage.goto('/')
          await expectSidebarRendered(authedPage)
          const fromIndex = rootCaptured.entries.length
          await navigateToRoute(authedPage, '/system/user', 'User')
          await waitForEnvelope(
            rootCaptured.entries,
            (entry) =>
              entry.url.includes(`${SystemRoutes.USER}/list`) &&
              entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
            20_000,
            fromIndex,
          )
          await expect(authedPage.getByTestId('user-list-table')).toBeVisible({ timeout: 20_000 })
          await expect(
            authedPage.getByTestId('user-create-btn'),
            'root 的 create 按钮应可见',
          ).toBeVisible({ timeout: 15_000 })
          await expect(
            authedPage.getByTestId('user-edit-btn').first(),
            'root 的行内 read 按钮应可见',
          ).toBeVisible({ timeout: 20_000 })
        } finally {
          rootCaptured.stop()
        }
      } finally {
        await deleteLoginableUser(user)
      }
    } finally {
      if (roleId !== '') {
        await withPg((pg) => deleteRoleById(pg, roleId)).catch(() => {})
      }
    }
  })

  /**
   * J7b 菜单给、依赖权限不给：`/system/dept/tree` 是**辅助依赖**，无权限时必须降级。
   *
   * 角色只挂 `system` catalog + `User` menu（不给任何 element）→ 以该账号 UI 登录。
   * 用户页 setup 里的 `useDeptTree()` 需要 `system:dept:list`，而该权限未授予。
   *
   * 曾经的缺陷（2026-11-27 发现，2026-11-28 修复）：hook 在 `onMounted` 无条件请求、
   * 只 `await pending`、没有 catch ⇒ 40105 的 rejection 冒到 `main.ts` 的
   * `reportRuntimeFatal(..., 'unhandledrejection')` ⇒ 全屏「页面遇到无法恢复的错误」遮罩，
   * 整页交互被锁死。修法（根因，不是绕过）：`useDeptTree` 先按权限点跳过注定被拒的请求
   * （与 `useTableAPI` 的 list 门禁同一写法），并对权限串 / 服务端缓存漂移时的 40105
   * 兜底吞掉 —— 两种情况都退化成空树，页面照常可用。
   *
   * 判据：**页面可用**（点查询能触发无权限提示 = 遮罩不存在，遮罩会拦截点击）+ 表格空 +
   * 按钮隐藏 + 没有发出注定 40105 的 dept/tree 请求。
   */
  test('J7b 菜单给、依赖权限不给：dept/tree 降级为空树，页面可用且不弹致命遮罩', async ({
    browser,
  }) => {
    const root = await rootClient()
    const roleName = `e2e-visibility-nodep-${Date.now()}`
    let roleId = ''

    try {
      const [systemCatalogId, userMenuId] = await withPg(async (pg) => {
        return [
          await findMenuIdByPath(pg, 'system', 'catalog'),
          await findMenuIdByName(pg, 'User', 'menu'),
        ] as const
      })
      const role = await root.root<{ id: string }>('POST', SystemRoutes.ROLE, {
        roleName,
        description: `${roleName} description`,
        order: 100,
        status: true,
        menus: [systemCatalogId, userMenuId],
      })
      roleId = role.id

      const { user, totpSecret } = await createJourneyUser(root, 'e2e-visibility-nodep', {
        roleId,
        bindTotp: true,
      })
      try {
        const session = await openDevice(browser, '/auth')
        const captured = captureEnvelopes(session.page)
        try {
          await loginViaUI(session.page, {
            userName: user.userName,
            password: user.password,
            totpSecret: totpSecret!,
          })

          await expect(
            session.page.getByTestId('user-list-table'),
            '菜单已授权，表格应挂载（dept 无权限不应把整页打掉）',
          ).toBeVisible({ timeout: 30_000 })

          // 「页面可用」的最强判据：遮罩是 fixed inset-0 的拦截层，存在时这步点击会超时。
          // 点击后无权限提示出现，证明交互链路仍然活着。
          await session.page.getByTestId('table-query-search').click()
          await expect(
            session.page.getByText(NO_AUTHORITY_TEXT).first(),
            '没有 list 权限时应提示无权限（而不是静默空表）',
          ).toBeVisible({ timeout: 15_000 })

          // 兜底负断言：致命遮罩的标题一次都不该出现（文案同 RuntimeErrorOverlay 的内置退化文案）
          await expect(
            session.page.getByText('页面遇到无法恢复的错误'),
            'dept/tree 无权限不应进入全屏致命遮罩',
          ).toHaveCount(0)

          // 与 J7 同口径的可见性裁剪：无 create 权限 ⇒ 表头按钮不渲染；无 list ⇒ 无数据行
          await expect(
            session.page.getByTestId('user-create-btn'),
            '无 create 权限时表头按钮不应渲染',
          ).toHaveCount(0)
          await expect(
            session.page.locator('tbody tr').filter({ hasText: 'admin' }),
            '无 list 权限时表格不应有数据行',
          ).toHaveCount(0)

          // 权限门禁在发请求之前：没有 dept:list 就不该打注定 40105 的请求
          const deptTreeEntry = captured.entries.find((entry) =>
            entry.url.includes(`${SystemRoutes.DEPT}/tree`),
          )
          expect(
            deptTreeEntry,
            `无 system:dept:list 时不该发出 dept/tree 请求（实际 ${deptTreeEntry?.url ?? '未发出'}）`,
          ).toBeUndefined()
        } finally {
          captured.stop()
          await session.context.close()
        }
      } finally {
        await deleteLoginableUser(user)
      }
    } finally {
      if (roleId !== '') {
        await withPg((pg) => deleteRoleById(pg, roleId)).catch(() => {})
      }
    }
  })
})
