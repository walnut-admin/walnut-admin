/**
 * 冒烟 ③：用户 CRUD（root 造 → 改 → 查列表 → 删）。
 *
 * 走**真实协议**（设备登记 → CAP → 签名握手 → OPAQUE 登录 → TOTP 设备验证），用 root 的
 * 权限短路直接打 /system/user 的五个端点 —— 不用 UI 表单：用户表单带角色树/部门树，
 * 点选的稳定性远低于协议；本批要验的是「全链路能用」，不是表单交互。
 *
 * 唯一前缀：`e2e-<时间戳>-<随机>`，断言列表 filters(like) 只命中这一条，最后删除并复核。
 * 自清理：用户行由本用例的 finally 删；自己那台设备交给 tests/fixtures.ts 的 auto fixture
 * （CASCADE 会带走 user_device / refresh_token）。
 */
import type { SystemUser } from '@walnut/api-types'
import type { SystemUserListPage } from '../../lib/protocol/api-types.ts'
import { randomBytes } from 'node:crypto'
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { SystemRoutes } from '../../lib/protocol/contract.ts'
import { readCredentials } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'

async function visitorRoleId(): Promise<string> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ id: string }>('SELECT id FROM sys_role WHERE role_name = $1', ['visitor'])
    const id = rows[0]?.id
    if (id === undefined) {
      throw new Error('[e2e] seed 里没有 visitor 角色（sys_role.json）')
    }
    return id
  })
}

test('用户 CRUD：root 造 → 改 → 查列表 → 删', { tag: '@smoke' }, async () => {
  const credentials = readCredentials()
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  const userName = `e2e-${Date.now()}-${randomBytes(3).toString('hex')}`
  let createdId = ''

  try {
    await client.bootstrap()
    // 立刻登记：后面的断言失败时，清理 fixture 仍要能找到这台设备
    trackDevice(client.deviceId)
    await client.login(credentials.userName, credentials.password)
    // MFA 是新设备必需的（stack.setup 已把 admin 的 mfa_setup 置 true）
    await client.verifyTotpForDevice(credentials.totpSecret)

    const roles = [await visitorRoleId()]

    // 1. 造。显式泛型用 `@walnut/api-types` 的 Safe 别名（生成侧 id 可选，别名补成必填）：
    //    「调用点可覆盖默认推导」的范本。
    const created = await client.root<SystemUser>('POST', SystemRoutes.USER, {
      userName,
      status: true,
      roles,
    })
    createdId = created.id
    expect(created.userName).toBe(userName)
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

    // 2. 改（改 status，其它字段原样回传 —— Update DTO 是 userName/status/roles 必填）
    const updated = await client.root<SystemUser>('PUT', `${SystemRoutes.USER}/${createdId}`, {
      userName,
      status: false,
      roles,
    })
    expect(updated.id).toBe(createdId)
    expect(updated.status).toBe(false)

    // 3. 查列表：唯一前缀 + like，只应命中这一条。
    //    显式泛型 SystemUserListPage 已从路径级响应推导（P2-6 修复后 data 是单个分页壳对象，
    //    见 lib/protocol/api-types.ts）；下面的 typeof / 枚举断言仍是「字段缺失」的可读判据。
    const list = await client.root<SystemUserListPage>('POST', `${SystemRoutes.USER}/list`, {
      filters: [{ field: 'userName', op: 'like', value: userName }],
      page: { page: 1, pageSize: 20 },
    })
    expect(typeof list.total).toBe('number')
    expect(list.total).toBe(1)
    expect(Array.isArray(list.data), 'user/list 缺 data 数组').toBe(true)
    expect(list.data).toHaveLength(1)
    const row = list.data[0]
    if (row === undefined) {
      throw new Error('[e2e/user-crud] user/list 命中 1 条但 data[0] 为空 —— 生成类型与运行时不一致')
    }
    expect(typeof row.id).toBe('string')
    expect(typeof row.userName).toBe('string')
    expect(row.userName).toBe(userName)
    // nickName 是 nullable 列：本用例创建时没传，list 行必须是 null（P2-6 偏差 3 的 wire 事实）
    expect(row.nickName).toBeNull()
    expect(typeof row.status).toBe('boolean')
    expect(row.status).toBe(false)
    expect(typeof row.roles_count, 'user/list 行缺 roles_count').toBe('number')

    // 4. 删
    const deleted = await client.root<SystemUser>('DELETE', `${SystemRoutes.USER}/${createdId}`)
    expect(deleted.id).toBe(createdId)
    createdId = ''

    // 删后列表必须为空（软删/硬删都符合：列表只返回「活着」的行）
    const after = await client.root<SystemUserListPage>('POST', `${SystemRoutes.USER}/list`, {
      filters: [{ field: 'userName', op: 'like', value: userName }],
      page: { page: 1, pageSize: 20 },
    })
    expect(after.total).toBe(0)
    expect(Array.isArray(after.data)).toBe(true)
    expect(after.data).toHaveLength(0)
  }
  finally {
    // 失败路径也要把半造的用户清掉（按用户名删除，避免留脏数据）；设备由清理 fixture 负责
    if (createdId !== '') {
      await withPg(async (pg) => {
        await pg.query('DELETE FROM sys_user WHERE user_name = $1', [userName])
      }).catch(() => {})
    }
  }
})
