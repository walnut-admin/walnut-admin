/**
 * risk 矩阵 U16：设备管理页（root）的可达性 + 列表命中 + 操作与 DB 行一致。
 *
 * 证伪什么：这一页是「设备身份」唯一的人工管理面 —— 列表真源是
 * `POST /system/device/list`（filters 走 contract 的显式算子），操作走
 * `PATCH /system/device/:id/lock|ban`。用例从 UI 真的点一次 lock（含确认对话框），
 * 断言点不是 UI 文案，而是 **DB 行**（`sys_device.locked`）与响应码 20000 同时成立。
 *
 * 前置用协议客户端造设备（一次 device/initial，秒级）；只有页面交互走 UI。
 * 设备（admin 登录设备 + victim）都由 fixtures 的 auto fixture 按 deviceId 清理。
 */
import { loginDevice, trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findDeviceRow, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { SystemRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { SIDEBAR_MENU_SELECTOR } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

/** `POST /system/device/list` 的列表壳（生成物的行只 pick 了 deviceId / id 等字段） */
interface DeviceListEnvelope {
  code: number
  data: { data: Array<{ id: string, deviceId: string }>, total: number }
}

test.describe('设备管理页', { tag: '@risk' }, () => {
  test('U16 root 设备管理页：列表含本用例设备，lock 后 DB 行与响应码一致', async ({ browser }) => {
    // victim：协议客户端只登记设备（不登录），列表里立刻可见
    const victim = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
    await victim.bootstrap()
    trackDevice(victim.deviceId)

    const victimRow = await withPg(pg => findDeviceRow(pg, victim.deviceId))
    if (victimRow === null) {
      throw new Error(`[e2e] sys_device 没有 ${victim.deviceId} 的行`)
    }
    expect(victimRow.locked, '前置：victim 设备不应已锁定').toBe(false)

    // admin 的 UI 登录（设备身份与 CAP / MFA 链路都真实走一遍）
    const session = await loginDevice(browser)
    const page = session.page

    try {
      // 列表请求在页面挂载时发出：先挂监听再导航
      const initialList = page.waitForResponse(
        response => response.url().includes(`${SystemRoutes.DEVICE}/list`) && response.request().method() === 'POST',
        { timeout: 40_000 },
      )
      await page.goto(SystemRoutes.DEVICE)
      await page.locator(SIDEBAR_MENU_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 })

      // 页面可达：路由停在该页 + 列表 20000
      expect(new URL(page.url()).pathname).toBe(SystemRoutes.DEVICE)
      const initialBody = await (await initialList).json() as DeviceListEnvelope
      expect(initialBody.code, '设备列表首屏请求不是 20000').toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(Array.isArray(initialBody.data.data), '设备列表缺 data 数组').toBe(true)

      // 列表含本条用例造的设备：用查询表单按 deviceName 过滤（唯一名由服务端生成）
      const queryForm = page.locator('form').first()
      const nameInput = queryForm.locator('input').first()
      await nameInput.waitFor({ state: 'visible', timeout: 15_000 })
      await nameInput.fill(victimRow.device_name)

      const searchedList = page.waitForResponse(
        response => response.url().includes(`${SystemRoutes.DEVICE}/list`) && response.request().method() === 'POST',
        { timeout: 30_000 },
      )
      // 回车 = `componentProp.onKeyupEnter` 触发查询（与搜索按钮同一条 onApiList；
      // 按钮在 WButton 的 100ms debounce 后面，回车路径更直接也更稳）
      await nameInput.press('Enter')
      const searchedResponse = await searchedList
      const requestBody = searchedResponse.request().postDataJSON() as {
        filters?: Array<{ field: string, op: string, value: unknown }>
      }
      expect(
        requestBody.filters?.some(filter => filter.field === 'deviceName' && filter.value === victimRow.device_name),
        '搜索请求的 filters 里没有 deviceName（查询表单没有提交？）',
      ).toBe(true)
      const searchedBody = await searchedResponse.json() as DeviceListEnvelope
      expect(searchedBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(
        searchedBody.data.data.some(row => row.deviceId === victim.deviceId),
        '过滤后的列表不包含本条用例的设备',
      ).toBe(true)

      // 卡片可见（设备名是服务端生成的唯一串）。
      // 类名是 `w-card`（admin 的 WCard 外壳），不是 naive 的 `n-card`。
      const card = page.locator('.w-card').filter({ hasText: victimRow.device_name }).first()
      await expect(card, '设备卡片没有出现在列表里').toBeVisible({ timeout: 20_000 })

      // 打开详情抽屉：先等 read 请求（20000），再断言 deviceId 字段是 victim
      const readResponse = page.waitForResponse(
        response => response.url().endsWith(`${SystemRoutes.DEVICE}/${victimRow.id}`) && response.request().method() === 'GET',
        { timeout: 30_000 },
      )
      await card.locator('button').first().click()
      const readBody = await (await readResponse).json() as { code: number }
      expect(readBody.code, '设备详情 read 请求不是 20000').toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      // admin 的 UI 库前缀是 `w-`（Naive UI 的 prefix 定制）：抽屉 / 对话框 / 卡片都不是 `n-` 类名
      const drawer = page.locator('.w-drawer')
      const footerButtons = drawer.locator('.w-drawer-footer button')
      await expect(footerButtons.first(), '详情抽屉的 footer 按钮没有出现').toBeVisible({ timeout: 20_000 })
      // 详情是 WForm 的 description 形态（表格文本，不是 input）：确认抽屉里是本用例的设备
      await expect(drawer.getByText(victim.deviceId, { exact: true }).first(), '详情抽屉的设备 ID 不是 victim').toBeVisible()

      // 点 lock（footer 第一个按钮）→ 确认对话框 → 正按钮
      const lockResponse = page.waitForResponse(
        response => response.url().endsWith(`${SystemRoutes.DEVICE}/${victimRow.id}/lock`) && response.request().method() === 'PATCH',
        { timeout: 30_000 },
      )
      await footerButtons.first().click()
      const confirmButton = page.locator('.w-dialog__action button:visible').last()
      await expect(confirmButton, '确认对话框没有出现').toBeVisible({ timeout: 15_000 })
      await confirmButton.click()

      const lockBody = await (await lockResponse).json() as { code: number }
      expect(lockBody.code, 'lock 操作没有回 20000').toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      // DB 行是最终判据：locked=true，banned 不受影响
      await withPg(async (pg) => {
        const row = await findDeviceRow(pg, victim.deviceId)
        expect(row, 'lock 之后 sys_device 行消失了').not.toBeNull()
        expect(row!.locked, 'UI 点了 lock，但 sys_device.locked 不是 true').toBe(true)
        expect(row!.banned, 'lock 不应顺带改 banned').toBe(false)
      })
    }
    finally {
      await session.context.close()
    }
  })
})
