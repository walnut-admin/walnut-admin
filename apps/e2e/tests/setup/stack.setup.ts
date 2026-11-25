/**
 * stack-setup：HTTP 引导（不碰浏览器）—— 后端就绪、**真实绑定 TOTP MFA**、root 可用性冒烟。
 *
 * 为什么 MFA 绑定放在这里而不是 prepare-db：
 * Playwright 的 webServer **先于** globalSetup / setup 项目启动，而 prepare-db 又在
 * `playwright test` 之前 —— 绑 MFA 需要的后端进程那时还不存在。绑定的前置条件只有
 * 「库已 seed + admin 已提升 root」，那正是 prepare-db 做完的事，于是顺序自然落在这里。
 *
 * 幂等：重跑 `playwright test`（不重建库）时，先清掉 admin 的 sys_user_mfa 行并把
 * mfa_setup 置 false，再走 generate → bind → verify(trusted=true)；不会撞 40001
 * （DataExists）。
 */
import type { SystemUserListPage } from '../../lib/protocol/api-types.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findDeviceLocation, LOOPBACK_IP_PATTERN, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { AuthRoutes, SystemRoutes } from '../../lib/protocol/contract.ts'
import { CREDENTIALS_FILE, readCredentials } from '../../scripts/env.ts'
import { test } from '../fixtures.ts'

test('stack：后端就绪 + admin 真实绑定 TOTP + root 权限可用', async () => {
  await WalnutProtocolClient.waitForHealth(60_000)

  const credentials = readCredentials()

  // 幂等清理：上一轮可能已经绑过 TOTP（不重建库的重跑）
  await withPg(async (pg) => {
    const user = await pg.query<{ id: string }>('SELECT id FROM sys_user WHERE user_name = $1', [credentials.userName])
    const userId = user.rows[0]?.id
    expect(userId, `库里没有账号 ${credentials.userName}`).toBeTruthy()
    await pg.query('DELETE FROM sys_user_mfa WHERE user_id = $1', [userId])
    await pg.query('UPDATE sys_user SET mfa_setup = false WHERE id = $1', [userId])
  })

  // 每台协议客户端一个 local IP：device/initial 的 throttle 是 4 次/60s per realIp
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  // 本用例签发的设备交给清理 fixture（断言失败时也要清掉）
  trackDevice(client.deviceId)

  // 设备登记的真实性：库里有行、形态合法（d1_ + 32 hex）
  expect(client.deviceId).toMatch(/^d1_[0-9a-f]{32}$/)
  await withPg(async (pg) => {
    const location = await findDeviceLocation(pg, client.deviceId)
    expect(location, `sys_device 没有 ${client.deviceId} 的行`).not.toBeNull()
    expect(location!.ip).toMatch(LOOPBACK_IP_PATTERN)
    // 本机 IP 走 getLocalLocation（零外网）：country 是 'LOCAL'
    expect(location!.country).toBe('LOCAL')
  })

  // 真实 OPAQUE 登录（identifiers 对齐的最终验证由 UI 在 auth-setup 里跑；
  // 这里先证明「协议客户端 + --admin 凭据」这条腿通）
  await client.login(credentials.userName, credentials.password)

  // generate → bind（otplib 现算 6 位码）→ verify(trusted=true)
  const totpSecret = await client.bindTotp()
  expect(totpSecret.length).toBeGreaterThanOrEqual(16)

  // 关键端点字段断言（P1-4）：TOTP 验证后才有完整权限，取 permissions 校验**生成类型的真实形状**。
  // 字段改名 / 容器形态变化时，这里先红；菜单树与路由树是 admin 侧导航的真源。
  const permissions = await client.root('GET', AuthRoutes.PERMISSIONS)
  expect(Array.isArray(permissions.permissionMenuTree), 'permissions 缺 permissionMenuTree 数组').toBe(true)
  expect(permissions.permissionMenuTree.length, 'root 的权限菜单树为空').toBeGreaterThan(0)
  expect(Array.isArray(permissions.permissionRouteTree), 'permissions 缺 permissionRouteTree 数组').toBe(true)
  expect(permissions.permissionRouteTree.length, 'root 的权限路由树为空').toBeGreaterThan(0)
  expect(Array.isArray(permissions.permissionStrings), 'permissions 缺 permissionStrings 数组').toBe(true)
  expect(permissions.permissionStrings.length, 'root 的权限字符串为空').toBeGreaterThan(0)
  expect(typeof permissions.indexMenuName, 'permissions 缺 indexMenuName').toBe('string')
  const firstRoute = permissions.permissionRouteTree[0]
  if (firstRoute === undefined) {
    throw new Error('[e2e/stack-setup] permissions.permissionRouteTree 第一项为空 —— 生成类型与运行时不一致')
  }
  expect(typeof firstRoute.path).toBe('string')
  expect(typeof firstRoute.name).toBe('string')
  expect(typeof firstRoute.component).toBe('string')

  // root 可用性：`${SystemRoutes.USER}/list` 是 permission.guard 的短路通路（roleNames[0]==='root'）
  // `/list` 后缀不在 contract 的命名端点里（e2e 侧组合，别为它改契约）。
  // P2-6 修复后生成物的路径级响应就是真实 wire（data 是单个分页壳对象），SystemUserListPage
  // 直接从路径推导（见 lib/protocol/api-types.ts）；下面的断言仍对着真实形状。
  const list = await client.root<SystemUserListPage>('POST', `${SystemRoutes.USER}/list`, { page: { page: 1, pageSize: 10 } })
  expect(typeof list.total).toBe('number')
  expect(Array.isArray(list.data), 'user/list 缺 data 数组').toBe(true)
  expect(list.data.length, 'user/list 返回空列表（seed 至少应有 admin）').toBeGreaterThan(0)
  const firstUser = list.data[0]
  if (firstUser === undefined) {
    throw new Error('[e2e/stack-setup] user/list 第一行为空 —— 生成类型与运行时不一致')
  }
  expect(typeof firstUser.id).toBe('string')
  expect(typeof firstUser.userName).toBe('string')
  // nickName 是 nullable 列（新建用户不传即 null）：只断言「字段存在 + string | null」，
  // 避免将来 list 首行恰是 null-nickName 用户时假红（P2-6 偏差 3 的断言小项）。
  expect(firstUser.nickName, 'user/list 行缺 nickName 字段').not.toBeUndefined()
  expect(
    firstUser.nickName === null || typeof firstUser.nickName === 'string',
    'user/list 行的 nickName 应为 string | null',
  ).toBe(true)
  expect(typeof firstUser.status).toBe('boolean')
  expect(typeof firstUser.roles_count, 'user/list 行缺 roles_count').toBe('number')

  // mfa_setup 已落库（后续新设备的 mfa.guard 会要求验证，而不是 40114）
  await withPg(async (pg) => {
    const user = await pg.query<{ mfa_setup: boolean }>('SELECT mfa_setup FROM sys_user WHERE user_name = $1', [credentials.userName])
    expect(user.rows[0]?.mfa_setup).toBe(true)
  })

  // 补上 TOTP secret（auth.setup / 各 spec 据此现算验证码）
  writeFileSync(
    CREDENTIALS_FILE,
    `${JSON.stringify({ ...readCredentials(), totpSecret }, null, 2)}\n`,
    'utf8',
  )

  // 自清理由 tests/fixtures.ts 的 auto fixture 负责（设备行 + 全部设备作用域 Redis 键）

  // 文件可读回（后续 spec 的唯一凭据真源）
  const saved = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as { totpSecret: string }
  expect(saved.totpSecret).toBe(totpSecret)
})
