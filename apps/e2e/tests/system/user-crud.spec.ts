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
import { randomBytes } from 'node:crypto'
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { SystemRoutes } from '../../lib/protocol/contract.ts'
import { readCredentials } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'

interface UserRow {
  id: string
  userName: string
  status: boolean
}

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

test('用户 CRUD：root 造 → 改 → 查列表 → 删', async () => {
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

    // 1. 造
    const created = await client.root<UserRow>('POST', SystemRoutes.USER, {
      userName,
      status: true,
      roles,
    })
    createdId = created.id
    expect(created.userName).toBe(userName)
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

    // 2. 改（改 status，其它字段原样回传 —— Update DTO 是 userName/status/roles 必填）
    const updated = await client.root<UserRow>('PUT', `${SystemRoutes.USER}/${createdId}`, {
      userName,
      status: false,
      roles,
    })
    expect(updated.id).toBe(createdId)
    expect(updated.status).toBe(false)

    // 3. 查列表：唯一前缀 + like，只应命中这一条
    const list = await client.root<{ total: number, data: UserRow[] }>('POST', `${SystemRoutes.USER}/list`, {
      filters: [{ field: 'userName', op: 'like', value: userName }],
      page: { page: 1, pageSize: 20 },
    })
    expect(list.total).toBe(1)
    expect(list.data[0]?.userName).toBe(userName)
    expect(list.data[0]?.status).toBe(false)

    // 4. 删
    const deleted = await client.root<UserRow>('DELETE', `${SystemRoutes.USER}/${createdId}`)
    expect(deleted.id).toBe(createdId)
    createdId = ''

    // 删后列表必须为空（软删/硬删都符合：列表只返回「活着」的行）
    const after = await client.root<{ total: number }>('POST', `${SystemRoutes.USER}/list`, {
      filters: [{ field: 'userName', op: 'like', value: userName }],
      page: { page: 1, pageSize: 20 },
    })
    expect(after.total).toBe(0)
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
