/**
 * risk 矩阵 U14 / U15：MFA trusted 与 trust 过期对 user-device CAP 的影响。
 *
 * 服务端真源（写断言前已对照）：
 * - `sys_user_device.trusted` / `trusted_expired_at` 是唯一状态落点（`user-device.entity.ts`）；
 * - post-auth 风险对 USER_DEVICE_* 的判定在 `risk/modules/user_device.service.ts`：
 *   `trusted=false` ⇒ USER_DEVICE_UNTRUSTED（critical）；`trusted=true` 且过期 ⇒
 *   USER_DEVICE_TRUST_EXPIRED（critical）；
 * - CAP guard 在 post-auth 腿命中 critical 因子且 CAP 凭据**有效**时，会把因子写进
 *   `risk:challenge:user-device:<userId>:<deviceId>:<FACTOR>`（服务端 api-spec 已确证：
 *   这个键只有 post-auth 腿写得出来）。
 *
 * 守卫链的一个事实（用例表「未 trusted 的设备会弹」在当前实现里不可达，按代码写不按文案写）：
 * CAP guard 的 **pre-auth 腿**也会硬校验凭据。凭据缺失/无效时：
 * - pre-auth 有 critical 因子（如 DEVICE_NEW）⇒ 40116（弹 cap-widget）；
 * - pre-auth 无因子 ⇒ **40117**（前端静默刷新），请求根本到不了 post-auth 腿。
 * 所以「只有 USER_DEVICE_* 因子、单靠它在当前请求弹窗」不存在；trusted / untrusted 的
 * **wire 可观测差异**是：untrusted 的请求会让 post-auth 腿写出 USER_DEVICE_UNTRUSTED 的
 * handled 标记（trusted 不会），且风险缓存里带该因子。两条用例都断言这个差异 + DB 行。
 *
 * 全部走协议客户端（秒级）；不 sleep 等 CAP token 的 20 分钟窗口。
 */
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import {
  backdateUserDeviceTrustExpiredAt,
  clearRefreshTokensForDevice,
  findUserDeviceRow,
  findUserIdByUserName,
  setUserDeviceTrustExpiredAt,
  withPg,
} from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import {
  SystemEndpointRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import {
  deleteAuthSessionsForDevice,
  deleteUserDeviceRiskState,
  readRiskUserDevice,
  riskChallengeUserDeviceKey,
  withRedis,
} from '../../lib/redis.ts'
import { readCredentials } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'
import { RISK_FACTOR } from './risk-support.ts'

const HOUR_MS = 60 * 60 * 1000

interface LoggedInDevice {
  client: WalnutProtocolClient
  deviceId: string
  userId: string
}

/** 新设备 + OPAQUE 登录 + TOTP 设备验证（trusted 由参数决定）；设备登记给清理 fixture */
async function loginDeviceWithTrust(trusted: boolean): Promise<LoggedInDevice> {
  const credentials = readCredentials()
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  trackDevice(client.deviceId)
  await client.login(credentials.userName, credentials.password)
  await client.verifyTotpForDevice(credentials.totpSecret, { trusted })
  const userId = await withPg((pg) => findUserIdByUserName(pg, credentials.userName))
  return { client, deviceId: client.deviceId, userId }
}

/** 用已登录 AT 打受保护的 profile 请求，返回响应壳（不抛错，便于断言业务码） */
async function profileEnvelope(
  client: WalnutProtocolClient,
): Promise<{ code: number; msg?: string }> {
  const tokens = client.tokens
  if (tokens === null) {
    throw new Error('[e2e] 请求前没有登录态（先 login）')
  }
  return client.requestFree<{ code: number; msg?: string }>(
    'GET',
    SystemEndpointRoutes.USER_ME_PROFILE,
    {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    },
  )
}

test.describe('MFA trusted 与 trust 过期', { tag: '@risk' }, () => {
  test('U14 trusted 设备再登录后 user-device 无 critical 因子（对照：未 trusted 设备写出该因子的 handled 标记）', async () => {
    const credentials = readCredentials()
    const trusted = await loginDeviceWithTrust(true)

    // 状态落点 1：DB 行 trusted=true 且过期时间在将来
    await withPg(async (pg) => {
      const row = await findUserDeviceRow(pg, trusted.userId, trusted.deviceId)
      expect(row, 'trusted 验证后 sys_user_device 行不存在').not.toBeNull()
      expect(row!.trusted, 'TOTP trusted=true 后 user_device.trusted 应为 true').toBe(true)
      expect(row!.trustedExpiredAt, 'trusted 行应有 trusted_expired_at').not.toBeNull()
      expect(
        row!.trustedExpiredAt!.getTime(),
        'trusted_expired_at 应在将来（服务端写 now + 30 天）',
      ).toBeGreaterThan(Date.now())
    })

    // 「再登录」：清 RT / 会话（避免 40109），同一台设备重走登录 + TOTP。
    // trusted 列在 `bindDeviceForUser` 的 upsert 里不会被重置（只更新 device_name）。
    await withPg((pg) => clearRefreshTokensForDevice(pg, trusted.deviceId))
    await withRedis((redis) => deleteAuthSessionsForDevice(redis, trusted.deviceId))
    // 首轮 verify 的 post-auth 风险看到的是「先 false 后 true」的旧快照，清掉让第二轮重新评估
    await withRedis((redis) => deleteUserDeviceRiskState(redis, trusted.userId, trusted.deviceId))
    // 客户端侧也要清 auth：login/start 是 JWT-free（单因子签名），带旧 AT 会 40112
    trusted.client.clearAuth()
    await trusted.client.login(credentials.userName, credentials.password)
    await trusted.client.verifyTotpForDevice(credentials.totpSecret)

    // 判据 1：同一请求 20000（没有 CAP 交互要求；CAP 凭据有效时 post-auth 腿静默放行）
    const account = await profileEnvelope(trusted.client)
    expect(
      account.code,
      `trusted 设备重登后 profile 应 20000，实际 ${account.code} ${account.msg ?? ''}`,
    ).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    // 判据 2：user-device 评估里没有 critical 因子
    const trustedFactors = await withRedis((redis) =>
      readRiskUserDevice(redis, trusted.userId, trusted.deviceId),
    )
    const trustedFactorList = trustedFactors?.factors ?? []
    expect(trustedFactorList, 'trusted 设备不应带 USER_DEVICE_UNTRUSTED').not.toContain(
      RISK_FACTOR.USER_DEVICE_UNTRUSTED,
    )
    expect(trustedFactorList, 'trusted 设备不应带 USER_DEVICE_TRUST_EXPIRED').not.toContain(
      RISK_FACTOR.USER_DEVICE_TRUST_EXPIRED,
    )

    // 判据 3：trusted 设备的 post-auth 腿不会写 USER_DEVICE_UNTRUSTED 的 handled 标记
    // （先清一次，再打一次请求 —— 标记仍然不存在，说明「免 user-device CAP」是因子层面的差异）
    await withRedis((redis) => deleteUserDeviceRiskState(redis, trusted.userId, trusted.deviceId))
    const again = await profileEnvelope(trusted.client)
    expect(again.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    const trustedMarker = await withRedis((redis) =>
      redis.exists(
        riskChallengeUserDeviceKey(
          trusted.userId,
          trusted.deviceId,
          RISK_FACTOR.USER_DEVICE_UNTRUSTED,
        ),
      ),
    )
    expect(trustedMarker, 'trusted 设备不应写出 USER_DEVICE_UNTRUSTED 的 handled 标记').toBe(0)

    // 对照：同用户另一台设备，TOTP trusted=false ⇒ 行 trusted=false、post-auth 腿写标记
    const untrusted = await loginDeviceWithTrust(false)
    await withPg(async (pg) => {
      const row = await findUserDeviceRow(pg, untrusted.userId, untrusted.deviceId)
      expect(row, '对照设备没有 user_device 行').not.toBeNull()
      expect(row!.trusted, 'trusted=false 的 TOTP 验证不应把设备标成 trusted').toBe(false)
    })
    await withRedis((redis) =>
      deleteUserDeviceRiskState(redis, untrusted.userId, untrusted.deviceId),
    )

    const control = await profileEnvelope(untrusted.client)
    expect(
      control.code,
      `未 trusted 设备的 profile 请求应 20000（凭据有效时静默通过），实际 ${control.code}`,
    ).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    const untrustedFactors = await withRedis((redis) =>
      readRiskUserDevice(redis, untrusted.userId, untrusted.deviceId),
    )
    expect(
      untrustedFactors?.factors ?? [],
      '未 trusted 设备的 user-device 评估应带 USER_DEVICE_UNTRUSTED',
    ).toContain(RISK_FACTOR.USER_DEVICE_UNTRUSTED)

    const untrustedMarker = await withRedis((redis) =>
      redis.exists(
        riskChallengeUserDeviceKey(
          untrusted.userId,
          untrusted.deviceId,
          RISK_FACTOR.USER_DEVICE_UNTRUSTED,
        ),
      ),
    )
    expect(
      untrustedMarker,
      '未 trusted 设备的 post-auth 腿应写 USER_DEVICE_UNTRUSTED 的 handled 标记',
    ).toBe(1)
  })

  test('U15 trust 过期：trusted_expired_at 回填到过去 ⇒ TRUST_EXPIRED 因子与 handled 标记（DB 行是唯一判据）', async () => {
    const device = await loginDeviceWithTrust(true)

    // 前置：trusted=true 且未过期
    await withPg(async (pg) => {
      const row = await findUserDeviceRow(pg, device.userId, device.deviceId)
      expect(row?.trusted).toBe(true)
      expect(row?.trustedExpiredAt).not.toBeNull()
      expect(row!.trustedExpiredAt!.getTime()).toBeGreaterThan(Date.now())
    })

    // 只把过期时间回填到过去：trusted 仍为 true ⇒ 命中 USER_DEVICE_TRUST_EXPIRED（不是 UNTRUSTED）
    await withPg((pg) =>
      backdateUserDeviceTrustExpiredAt(pg, device.userId, device.deviceId, HOUR_MS),
    )

    // DB 行是唯一判据：trusted=true（不是被重置）+ 过期时间在过去
    const expired = await withPg((pg) => findUserDeviceRow(pg, device.userId, device.deviceId))
    expect(expired, '回填后 user_device 行消失了').not.toBeNull()
    expect(expired!.trusted, '回填过期时间不应重置 trusted 列').toBe(true)
    expect(expired!.trustedExpiredAt, 'trusted_expired_at 应仍在（只是变成过去）').not.toBeNull()
    expect(
      expired!.trustedExpiredAt!.getTime(),
      'trusted_expired_at 没有被回填到过去',
    ).toBeLessThan(Date.now())

    // 清掉旧的 handled 标记 / 评估缓存，让这次请求重新评估出 TRUST_EXPIRED
    await withRedis((redis) => deleteUserDeviceRiskState(redis, device.userId, device.deviceId))

    const challenged = await profileEnvelope(device.client)
    expect(
      challenged.code,
      `trust 过期后的 profile 请求应是 20000（凭据有效时 post-auth 腿静默通过），实际 ${challenged.code} ${challenged.msg ?? ''}`,
    ).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    // 风险评估落点：TRUST_EXPIRED 在、UNTRUSTED 不在（证明触发的是过期而不是未信任）
    const factors = await withRedis((redis) =>
      readRiskUserDevice(redis, device.userId, device.deviceId),
    )
    const factorList = factors?.factors ?? []
    expect(factorList, 'trust 过期后 user-device 评估应带 USER_DEVICE_TRUST_EXPIRED').toContain(
      RISK_FACTOR.USER_DEVICE_TRUST_EXPIRED,
    )
    expect(factorList, 'trusted 仍为 true，不应带 USER_DEVICE_UNTRUSTED').not.toContain(
      RISK_FACTOR.USER_DEVICE_UNTRUSTED,
    )

    // 「重新要求 CAP」的状态落点：post-auth 腿把 TRUST_EXPIRED 标为已处理（只有验证过 CAP 才会写）
    const handled = await withRedis((redis) =>
      redis.exists(
        riskChallengeUserDeviceKey(
          device.userId,
          device.deviceId,
          RISK_FACTOR.USER_DEVICE_TRUST_EXPIRED,
        ),
      ),
    )
    expect(handled, 'TRUST_EXPIRED 的 handled 标记没有落 Redis').toBe(1)

    // 负对照（闭环）：把过期时间拨回将来 + 清标记 ⇒ 同一请求 20000，TRUST_EXPIRED 因子与标记都消失。
    // 这一步证明上面的因子确实由 trusted_expired_at 驱动，而不是其它状态残留。
    await withPg((pg) =>
      setUserDeviceTrustExpiredAt(
        pg,
        device.userId,
        device.deviceId,
        new Date(Date.now() + HOUR_MS),
      ),
    )
    await withRedis((redis) => deleteUserDeviceRiskState(redis, device.userId, device.deviceId))

    const replayed = await profileEnvelope(device.client)
    expect(replayed.code, '过期时间拨回将来后，同一请求应 20000').toBe(
      WalnutAdminConstAppResponseCode.SUCCESS,
    )

    const afterFactors = await withRedis((redis) =>
      readRiskUserDevice(redis, device.userId, device.deviceId),
    )
    expect(
      afterFactors?.factors ?? [],
      '恢复信任后 USER_DEVICE_TRUST_EXPIRED 应消失',
    ).not.toContain(RISK_FACTOR.USER_DEVICE_TRUST_EXPIRED)
    const afterHandled = await withRedis((redis) =>
      redis.exists(
        riskChallengeUserDeviceKey(
          device.userId,
          device.deviceId,
          RISK_FACTOR.USER_DEVICE_TRUST_EXPIRED,
        ),
      ),
    )
    expect(afterHandled, '恢复信任后不应再写 TRUST_EXPIRED 的 handled 标记').toBe(0)
  })
})
