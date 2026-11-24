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
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { deleteDeviceRow, findDeviceLocation, LOOPBACK_IP_PATTERN, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { deleteDeviceKeys, withRedis } from '../../lib/redis.ts'
import { CREDENTIALS_FILE, readCredentials } from '../../scripts/env.ts'

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

  // root 可用性：/system/user/list 是 permission.guard 的短路通路（roleNames[0]==='root'）
  const list = await client.root<{ total: number }>('POST', '/system/user/list', { page: { page: 1, pageSize: 10 } })
  expect(typeof list.total).toBe('number')

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

  // 自清理：这个协议客户端自己的设备行与缓存（用例只留下 admin 账号与 TOTP）
  await withPg(async (pg) => {
    await deleteDeviceRow(pg, client.deviceId)
  })
  await withRedis(async (redis) => {
    await deleteDeviceKeys(redis, client.deviceId)
  })

  // 文件可读回（后续 spec 的唯一凭据真源）
  const saved = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as { totpSecret: string }
  expect(saved.totpSecret).toBe(totpSecret)
})
