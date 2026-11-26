import type { Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { countDeletedRows, deleteUserByUserName, findDeletedRowByDeletedId, findRoleIdByName, withPg } from '../../lib/pg.ts'
import { SystemEndpointRoutes, SystemRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { captureEnvelopes, expectSidebarRendered, navigateToRoute, waitForEnvelope } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

/**
 * J9 回收站闭环：删业务行 → 回收站按快照内容搜到 → 恢复回业务表 → 再删后真删（不可恢复）。
 *
 * 服务端真源：
 * - 用户删除是**软删**：`DELETE /system/user/:id` 把行快照写进 `sys_deleted`
 *   （`content` = 原行 jsonb，`model_name` = 恢复路由键，`deleted_by` = 操作者，`deleted_at`）；
 * - 回收站 list 的 `content` 过滤是 jsonb `::text` 的 ILIKE（`SysDeletedBasicRepository`），
 *   所以能按**被删行的字段值**（这里用唯一 userName）检索 —— 这正是「服务端生成的快照」用途；
 * - 恢复 `POST /system/deleted/recover` 按 `id + deletedId` 双键定位（管理端 root/admin），
 *   原行插回 + 删快照行（同一事务）；真删 `DELETE /system/deleted/deleteMany/:ids` 只删快照，
 *   原表不回来 —— 之后的 recover 必须 40401。
 *
 * 为什么用用户行：它是真实业务实体、软删可逆、且唯一名天然可检索（E1 已给回收站表格与
 * 恢复按钮加 testid：`deleted-list-table` / `deleted-recover-btn`）。UI 只做「搜 + 恢复」，
 * 真删走真实端点（批量删除按钮的交互是表格选择态，不是本旅程的判据）。
 */

/** 一次性用户名（列表按 like 命中唯一一条） */
function uniqueUserName(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(3).toString('hex')}`
}

/** 用 root 建一条**只有主行**的用户（不设口令：删除/恢复都不需要登录能力） */
async function createDeletableUser(root: Awaited<ReturnType<typeof rootClient>>): Promise<{ id: string, userName: string }> {
  const userName = uniqueUserName('e2e-recycle')
  const visitorRoleId = await withPg(pg => findRoleIdByName(pg, 'visitor'))
  const created = await root.root<{ id: string }>('POST', SystemRoutes.USER, {
    userName,
    status: true,
    roles: [visitorRoleId],
  })
  return { id: created.id, userName }
}

/**
 * 回收站页按 userName 搜一次，返回命中的快照行（列表行不含 `content`，按 `deletedId` 认领）。
 *
 * `content` 的模糊检索是服务端 jsonb `::text` 的 ILIKE（不在列表行回显）——「搜到」的证据是
 * `total === 1` 且该行 `deletedId` 等于被删主键，而不是行里出现 userName。
 */
async function searchRecycleBin(page: Page, userName: string, expectedDeletedId: string): Promise<void> {
  const queryInput = page.getByTestId('table-query-form').locator('input').first()
  await queryInput.fill(userName)
  const listResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/api${SystemRoutes.DELETED}/list`))
  await page.getByTestId('table-query-search').click()
  const body = await (await listResponse).json() as {
    code: number
    data: { total: number, data: Array<{ id: string, deletedId: string }> }
  }
  expect(body.code, '回收站 list 失败').toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  expect(body.data.total, '按唯一 userName 的 content 搜索应只命中 1 条快照').toBe(1)
  expect(body.data.data[0]!.deletedId, '命中的快照行不是被删的那一行').toBe(expectedDeletedId)
}

test.describe('回收站闭环 journey', { tag: '@journey' }, () => {
  test('J9 删除进 sys_deleted → 按快照名搜到 → 恢复回业务表 → 再删后真删不可恢复', async ({ authedPage }) => {
    const root = await rootClient()
    const user = await createDeletableUser(root)

    try {
      // 1. 软删：进 sys_deleted，快照里就是被删行
      await root.root('DELETE', `${SystemRoutes.USER}/${user.id}`)
      await expect.poll(() => withPg(pg => countDeletedRows(pg, user.id)), { timeout: 10_000 }).toBe(1)

      const snapshot = await withPg(pg => findDeletedRowByDeletedId(pg, user.id))
      expect(snapshot, 'sys_deleted 没有该行的快照').not.toBeNull()
      // 恢复路由键沿用 Mongo 时代的模型名（`WalnutModelName.SYS_USER = 'SysUser'`），
      // 不是 PG 表名 —— registry 按它路由 recoverer
      expect(snapshot!.modelName, '恢复路由键应为 SysUser').toBe('SysUser')
      expect(snapshot!.content.userName, '快照 content 里应是被删行的 userName').toBe(user.userName)
      expect(snapshot!.content.id, '快照 content 里应是被删行的 id').toBe(user.id)
      expect(snapshot!.deletedBy, '快照应记录删除者 uuid').toMatch(/^[0-9a-f-]{36}$/)
      expect(snapshot!.deletedAt, '快照应记录删除时间').not.toBeNull()

      // 2. 回收站页：按唯一 userName 搜到快照行，点恢复（confirm → 确认）
      const captured = captureEnvelopes(authedPage)
      try {
        await authedPage.goto('/')
        await expectSidebarRendered(authedPage)
        const fromIndex = captured.entries.length
        await navigateToRoute(authedPage, '/system/deleted', 'Deleted')
        await expect(authedPage.getByTestId('deleted-list-table'), '回收站表格没挂载').toBeVisible({ timeout: 30_000 })
        await waitForEnvelope(
          captured.entries,
          entry => entry.url.includes(`${SystemRoutes.DELETED}/list`) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
          20_000,
          fromIndex,
        )

        await searchRecycleBin(authedPage, user.userName, user.id)
        // 唯一命中 ⇒ 表格只剩这一行（列表行不带 content，用行数 + 该行的恢复按钮定位）
        await expect(authedPage.locator('tbody tr'), '按唯一 userName 搜索后表格应只剩这一条快照').toHaveCount(1, { timeout: 20_000 })
        const row = authedPage.locator('tbody tr').first()
        await expect(row.getByTestId('deleted-recover-btn'), '快照行缺恢复按钮').toBeVisible({ timeout: 20_000 })

        const recoverResponse = authedPage.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(`/api${SystemEndpointRoutes.DELETED_RECOVER}`),
        )
        await row.getByTestId('deleted-recover-btn').click()
        // 行内按钮的 confirm 是 popconfirm（与 lock J3 的 reset-lock 同一个组件）
        await authedPage.getByRole('button', { name: '确认' }).click({ force: true, timeout: 10_000 })
        const recoverBody = await (await recoverResponse).json() as { code: number, data: boolean, msg?: string }
        expect(recoverBody.code, `恢复失败：${recoverBody.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        expect(recoverBody.data).toBe(true)
      }
      finally {
        captured.stop()
      }

      // 3. 恢复后：快照行消失，业务行回来了
      await expect.poll(() => withPg(pg => countDeletedRows(pg, user.id)), { timeout: 10_000 }).toBe(0)
      const restored = await root.root<{ id: string, userName: string }>('GET', `${SystemRoutes.USER}/${user.id}`)
      expect(restored.userName).toBe(user.userName)

      // 4. 再删 → 真删快照行（deleteMany 的 :ids 是快照行 id，不是被删行 id）
      await root.root('DELETE', `${SystemRoutes.USER}/${user.id}`)
      await expect.poll(() => withPg(pg => countDeletedRows(pg, user.id)), { timeout: 10_000 }).toBe(1)
      const second = await withPg(pg => findDeletedRowByDeletedId(pg, user.id))
      expect(second).not.toBeNull()

      const deleted = await root.root<Array<{ id: string }>>('DELETE', `${SystemRoutes.DELETED}/deleteMany/${second!.id}`)
      expect(deleted.map(item => item.id), '真删应返回被删的快照行 id').toEqual([second!.id])
      expect(await withPg(pg => countDeletedRows(pg, user.id)), '真删后 sys_deleted 行应消失').toBe(0)

      // 5. 真删不可恢复：业务行仍在回收站外（40401），用旧双键 recover 也必须 40401
      // requestFree 不会自动带 Authorization（只有 root() 会）—— 显式带 root 的 AT
      const authorization = { Authorization: `Bearer ${root.tokens!.accessToken}` }
      const gone = await root.requestFree<{ code: number }>('GET', `${SystemRoutes.USER}/${user.id}`, { headers: authorization })
      expect(gone.code, '真删后原表不应回来').toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

      const recoverAgain = await root.requestFree<{ code: number }>('POST', SystemEndpointRoutes.DELETED_RECOVER, {
        headers: authorization,
        body: { id: second!.id, deletedId: second!.deletedId },
      })
      expect(recoverAgain.code, '快照行已真删，再 recover 必须 40401').toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
    }
    finally {
      // 用户行可能已被真删；按 name 兜底（软删状态下删不到行也不报错）
      await withPg(pg => deleteUserByUserName(pg, user.userName)).catch(() => {})
    }
  })
})
