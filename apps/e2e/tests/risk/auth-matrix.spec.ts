/**
 * auth 面矩阵补格：MFA 绑定态 × 设备信任态 × 会话态。
 *
 * 与 U14 / U15 的分工（不重复覆盖）：
 * - U14：trusted 设备（再登录无 USER_DEVICE_* 因子）vs 未 trusted 设备（有因子 + handled 标记）；
 * - U15：trusted=true 但 trusted_expired_at 在过去 ⇒ TRUST_EXPIRED 因子 + 标记，拨回将来即消失；
 * - **本文件**补 U14/U15 没覆盖的格：MFA 未绑定、MFA 已绑定但本设备未验证、TOTP 备用码
 *   （恢复码）一次性、TOTP 解绑后重绑、多设备在线 + 踢下线、主动登出。
 *
 * 服务端真源（写断言前已对照）：
 * - MFA guard（`libs/guards/src/guards/mfa.guard.ts`）：`user.mfaSetup === false` ⇒ **40114**
 *   （要求先绑定）；`mfaSetup=true` 且本设备未验证 ⇒ **40115**；visitor 角色跳过；
 * - `sys_user.mfa_setup` 由 `/auth/mfa/verify` 写 true（`AuthMfaService.verifyMfaStatus`），
 *   bind 本身不置位；②（2026-11）起 `/system/user/mfa/totp/unbind` 在删行的同一事务里把
 *   `mfa_setup` 回落 false（此前要等 cron）—— M4 同时断言行删除与账号级标志的即时回落，
 *   重绑并 verify 后再回到 true；
 * - 备用码：bind 响应返回 10 枚明文，服务端只存哈希后的密文数组（`sys_user_mfa.backup_codes_ciphertext`）；
 *   verify 端点先 TOTP 后备用码回落，命中即消费（P3-23），复用同一枚 ⇒ 40000；
 * - 会话：JWT validate 按 `AUTH:SESSIONS:<userId>:<deviceId>:<sid>` 判存在（P0-4）；
 *   踢下线（`user-kick-other`）与登出（`user-logout`）都会撤 RT + 清会话键 ⇒ 旧 AT 下一次请求
 *   **40101**（不是 40112 —— JWT 层先拒）；
 * - force-quit 端点按 `(userId, deviceId)` 查 `app_monitor_user`（协议客户端不连 socket，
 *   该行在真实 UI 设备上由 socket 上报创建，fixture 补一条等价前置；踢人链路本身全真跑）。
 *
 * 全部走协议客户端（秒级）；不 sleep 等 CAP / TOTP 窗口。
 */
import { createLoginableUser, deleteLoginableUser, loginAs } from '../../lib/account-fixtures.ts'
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import {
  countActiveRefreshTokensForDevice,
  deleteMonitorUserByDeviceId,
  findRoleIdByName,
  findTotpMfaRow,
  findUserDeviceRow,
  findUserIdByUserName,
  insertMonitorUserRow,
  readUserMfaSetup,
  withPg,
} from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import {
  AuthRoutes,
  SystemEndpointRoutes,
  SystemRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { authSessionKeyPattern, scanKeys, withRedis } from '../../lib/redis.ts'
import { readCredentials } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'

/** seed 里的非 root 角色：权限走角色名短路之外的正常路径，且 MFA guard 不会被 visitor 跳过 */
const NON_MFA_FREE_ROLE = 'test-home'

interface Envelope {
  code: number
  msg?: string
}

/** 用客户端当前 AT 打受保护端点，返回响应壳（不抛错，便于断言业务码） */
async function profileEnvelope(client: WalnutProtocolClient): Promise<Envelope> {
  const tokens = client.tokens
  if (tokens === null) {
    throw new Error('[e2e] 请求前没有登录态（先 login）')
  }
  return client.requestFree<Envelope>('GET', SystemEndpointRoutes.USER_ME_PROFILE, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  })
}

/** 建一个挂 test-home 角色的可登录用户（MFA 未绑定；设备由清理 fixture 收） */
async function createPlainUser(
  root: WalnutProtocolClient,
  prefix: string,
): Promise<Awaited<ReturnType<typeof createLoginableUser>>> {
  const roleId = await withPg((pg) => findRoleIdByName(pg, NON_MFA_FREE_ROLE))
  return createLoginableUser(root, { userNamePrefix: prefix, roleId })
}

test.describe('auth 面矩阵（MFA / 会话 / 登出）', { tag: '@risk' }, () => {
  test('M1 MFA 未绑定：登录成功但受保护端点 40114；无 totp 行、设备行未信任', async () => {
    const root = await rootClient()
    const user = await createPlainUser(root, 'e2e-auth-nomfa')

    try {
      const client = await loginAs(user)
      // 登录本身成功（OPAQUE + CAP + 签名握手全通），MFA 的拦截发生在受保护端点
      expect(client.tokens).not.toBeNull()

      const envelope = await profileEnvelope(client)
      expect(
        envelope.code,
        `mfa_setup=false 的设备打受保护端点应 40114（需要 MFA），实际 ${envelope.code} ${envelope.msg ?? ''}`,
      ).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED)

      await withPg(async (pg) => {
        expect(await readUserMfaSetup(pg, user.userId), '新用户 mfa_setup 应为 false').toBe(false)
        // 登录链本身会 upsert sys_user_device 行（trusted=false）；区别在「没有 totp 凭据」，
        // 而不是「没有设备行」—— 这一点是 M1 与 M2 的矩阵边界。
        expect(await findTotpMfaRow(pg, user.userId), '未绑定 MFA 的用户不应有 totp 行').toBeNull()
        const deviceRow = await findUserDeviceRow(pg, user.userId, client.deviceId)
        expect(deviceRow, '登录后应有该设备的 sys_user_device 行').not.toBeNull()
        expect(deviceRow!.trusted, '未走 TOTP 验证的设备不应是 trusted').toBe(false)
      })
    } finally {
      await deleteLoginableUser(user)
    }
  })

  test('M2 MFA 已绑定、本设备未验证：40115 → TOTP 验证后 20000 + trusted=false 行', async () => {
    const root = await rootClient()
    const user = await createPlainUser(root, 'e2e-auth-mfa')

    try {
      // 设备 A 绑定 TOTP：bind → /auth/mfa/verify 把 mfa_setup 置 true
      const deviceA = await loginAs(user)
      const secret = await deviceA.bindTotp()
      await withPg(async (pg) => {
        expect(await readUserMfaSetup(pg, user.userId), '绑定后 mfa_setup 应为 true').toBe(true)
      })

      // 设备 B：全新设备、未在本设备验证过 MFA ⇒ 40115
      const deviceB = await loginAs(user)
      const challenged = await profileEnvelope(deviceB)
      expect(
        challenged.code,
        `mfa_setup=true 且本设备未验证应 40115，实际 ${challenged.code} ${challenged.msg ?? ''}`,
      ).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)

      // 用 TOTP 完成设备级验证（trusted=false ⇒ 不写信任时间）
      await deviceB.verifyTotpForDevice(secret, { trusted: false })
      const passed = await profileEnvelope(deviceB)
      expect(passed.code, `TOTP 验证后应 20000，实际 ${passed.code} ${passed.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.SUCCESS,
      )

      await withPg(async (pg) => {
        const row = await findUserDeviceRow(pg, user.userId, deviceB.deviceId)
        expect(row, 'TOTP 设备验证后没有 sys_user_device 行').not.toBeNull()
        expect(row!.trusted, 'trusted=false 的验证不应把设备标成 trusted').toBe(false)
      })
    } finally {
      await deleteLoginableUser(user)
    }
  })

  test('M3 备用码（恢复码）：bind 返回 10 枚，新设备用备用码验证成功且一次性消费', async () => {
    const root = await rootClient()
    const user = await createPlainUser(root, 'e2e-auth-backup')

    try {
      const deviceA = await loginAs(user)
      const { backupCodes } = await deviceA.bindTotpWithBackupCodes()
      expect(backupCodes, 'bind 应返回 10 枚备用码').toHaveLength(10)

      await withPg(async (pg) => {
        const row = await findTotpMfaRow(pg, user.userId)
        expect(row, 'bind 后没有 sys_user_mfa totp 行').not.toBeNull()
        expect(row!.backupCodesLeft, 'bind 后备用码密文数组应有 10 项').toBe(10)
      })

      // 新设备用备用码走同一 verify 端点（不是 TOTP 六位码）
      const backupCode = backupCodes[0]!
      const deviceB = await loginAs(user)
      await deviceB.verifyMfaCode(backupCode, { trusted: false })
      await expect(profileEnvelope(deviceB)).resolves.toMatchObject({
        code: WalnutAdminConstAppResponseCode.SUCCESS,
      })

      await withPg(async (pg) => {
        const row = await findTotpMfaRow(pg, user.userId)
        expect(row!.backupCodesLeft, '备用码命中后没有被消费（应剩 9 枚）').toBe(9)
      })

      // 一次性：同一枚备用码再用一次 ⇒ 40000，且不会二次消费
      const tokens = deviceB.tokens!
      const reuse = await deviceB.requestFree<Envelope>(
        'POST',
        SystemEndpointRoutes.USER_MFA_TOTP_VERIFY,
        {
          body: { code: backupCode, trusted: false },
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        },
      )
      expect(reuse.code, `已消费的备用码应被拒 40000，实际 ${reuse.code} ${reuse.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.BAD_REQUEST,
      )

      await withPg(async (pg) => {
        expect(
          (await findTotpMfaRow(pg, user.userId))!.backupCodesLeft,
          '失败重放不应再消费备用码',
        ).toBe(9)
      })
    } finally {
      await deleteLoginableUser(user)
    }
  })

  test('M4 TOTP 解绑：sys_user_mfa 行删除，重绑生成新的一批备用码', async () => {
    const root = await rootClient()
    const user = await createPlainUser(root, 'e2e-auth-unbind')

    try {
      const device = await loginAs(user)
      const first = await device.bindTotpWithBackupCodes()
      await withPg(async (pg) => {
        expect(await findTotpMfaRow(pg, user.userId), 'bind 后应有 totp 行').not.toBeNull()
        expect(
          await readUserMfaSetup(pg, user.userId),
          'bind + verify 后 mfa_setup 应为 true',
        ).toBe(true)
      })

      await expect(
        device.root<boolean>('DELETE', SystemEndpointRoutes.USER_MFA_TOTP_UNBIND),
      ).resolves.toBe(true)

      await withPg(async (pg) => {
        expect(
          await findTotpMfaRow(pg, user.userId),
          'unbind 后 sys_user_mfa 行应被删除',
        ).toBeNull()
        // ②（2026-11）：账号级标志在同一事务里立即回落，不再等 cron
        expect(await readUserMfaSetup(pg, user.userId), 'unbind 后 mfa_setup 应立即为 false').toBe(
          false,
        )
      })

      // 「只存在禁用和重新绑定」：同设备重新 generate → bind → verify，拿到新的一批备用码
      const second = await device.bindTotpWithBackupCodes()
      expect(second.backupCodes, '重绑应返回新的 10 枚备用码').toHaveLength(10)
      expect(second.backupCodes, '重绑不应复用旧备用码').not.toEqual(first.backupCodes)

      await withPg(async (pg) => {
        const row = await findTotpMfaRow(pg, user.userId)
        expect(row, '重绑后没有 totp 行').not.toBeNull()
        expect(row!.backupCodesLeft).toBe(10)
        expect(
          await readUserMfaSetup(pg, user.userId),
          '重绑 + verify 后 mfa_setup 应回到 true',
        ).toBe(true)
      })
      await expect(profileEnvelope(device)).resolves.toMatchObject({
        code: WalnutAdminConstAppResponseCode.SUCCESS,
      })
    } finally {
      await deleteLoginableUser(user)
    }
  })

  test('M5 多设备在线：device/list 同时可见 → root 踢掉另一台 → 被踢设备 40101、本机仍 20000', async () => {
    const credentials = readCredentials()
    const deviceA = await rootClient()

    // 设备 B：同用户（admin）的一台全新设备，完成 TOTP 设备验证
    const deviceB = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
    await deviceB.bootstrap()
    trackDevice(deviceB.deviceId)
    await deviceB.login(credentials.userName, credentials.password)
    await deviceB.verifyTotpForDevice(credentials.totpSecret)

    const adminUserId = await withPg((pg) => findUserIdByUserName(pg, credentials.userName))

    try {
      // 多设备在线：device/list 同时列出 A / B，且只有 A 是 current
      const devices = await deviceA.root<{
        data: Array<{ deviceId: string; current: boolean }>
        total: number
      }>('GET', SystemEndpointRoutes.USER_DEVICE_LIST)
      expect(devices.total, 'device/list 应至少有两台在线设备').toBeGreaterThanOrEqual(2)
      const listedB = devices.data.find((row) => row.deviceId === deviceB.deviceId)
      expect(listedB, 'device/list 里没有第二台设备').not.toBeUndefined()
      expect(listedB!.current, '第二台设备不应标成 current').toBe(false)
      const listedA = devices.data.find((row) => row.deviceId === deviceA.deviceId)
      expect(listedA?.current, '当前设备应标成 current').toBe(true)

      // force-quit 的前置：真实 UI 设备由 socket 写 monitor 行；协议设备补一条等价行
      await withPg((pg) => insertMonitorUserRow(pg, adminUserId, deviceB.deviceId))

      await expect(
        deviceA.root<boolean>(
          'DELETE',
          `${SystemRoutes.USER_DEVICE}/force-quit/${deviceB.deviceId}`,
        ),
      ).resolves.toBe(true)

      // 被踢设备：JWT 会话键已清 ⇒ 旧 AT 下一次请求 40101
      const kicked = await profileEnvelope(deviceB)
      expect(kicked.code, `被踢设备的旧 AT 应 40101，实际 ${kicked.code} ${kicked.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED,
      )

      // 本机不受影响
      await expect(profileEnvelope(deviceA)).resolves.toMatchObject({
        code: WalnutAdminConstAppResponseCode.SUCCESS,
      })

      await withPg(async (pg) => {
        expect(
          await countActiveRefreshTokensForDevice(pg, deviceB.deviceId),
          '被踢设备的 RT 仍有现役行',
        ).toBe(0)
      })
      await expect(
        withRedis((redis) => scanKeys(redis, authSessionKeyPattern(deviceB.deviceId))),
      ).resolves.toEqual([])
    } finally {
      await withPg((pg) => deleteMonitorUserByDeviceId(pg, deviceB.deviceId)).catch(() => {})
    }
  })

  test('M6 主动登出：signout 后旧 AT 40101，RT 与会话键都清空', async () => {
    const client = await rootClient()
    const deviceId = client.deviceId

    await expect(client.root<boolean>('POST', AuthRoutes.SIGNOUT)).resolves.toBe(true)

    const after = await profileEnvelope(client)
    expect(after.code, `登出后旧 AT 应 40101，实际 ${after.code} ${after.msg ?? ''}`).toBe(
      WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED,
    )

    await withPg(async (pg) => {
      expect(await countActiveRefreshTokensForDevice(pg, deviceId), '登出后仍有现役 RT 行').toBe(0)
    })
    await expect(
      withRedis((redis) => scanKeys(redis, authSessionKeyPattern(deviceId))),
    ).resolves.toEqual([])
  })
})
