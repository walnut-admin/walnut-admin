/**
 * risk 矩阵（U11–U16）的共用前置：已登录 root 协议客户端、设备行 uuid、风控因子常量。
 *
 * 为什么单独成文件而不是塞进某个 spec：U11（黑名单）与 U13–U15（CAP / trust）都要 root
 * 权限与设备行，复制三份 rootClient 会让「每台设备一个 uniqueLocalIp + trackDevice」这条
 * 不变量在某个副本里悄悄漏掉。文件名不匹配 `risk/*.spec.ts`，Playwright 不会把它当用例收走。
 */
import { trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findDeviceRow, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { readCredentials } from '../../scripts/env.ts'

/**
 * 风控因子字面量（服务端 `apps/server/libs/security/src/risk/risk.config.service.ts` 的
 * `WalnutAdminConstRiskFactor`）。Redis 里的评估缓存存的就是这些字符串，E2E 断言直接对齐；
 * 它们不是业务码，不在 contract 里，所以在这里以常量收口（服务端改名时该文件是唯一同步点）。
 */
export const RISK_FACTOR = {
  DEVICE_NEW: 'DEVICE_NEW',
  USER_DEVICE_UNTRUSTED: 'USER_DEVICE_UNTRUSTED',
  USER_DEVICE_TRUST_EXPIRED: 'USER_DEVICE_TRUST_EXPIRED',
} as const

/** 建一个已登录的 root 协议客户端（自带设备 + TOTP 设备验证）；设备随即登记给清理 fixture */
export async function rootClient(): Promise<WalnutProtocolClient> {
  const credentials = readCredentials()
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  trackDevice(client.deviceId)
  await client.login(credentials.userName, credentials.password)
  await client.verifyTotpForDevice(credentials.totpSecret)
  return client
}

/** `sys_device.id`（uuid）—— admin 的 ban/lock 端点按 uuid 定位 */
export async function deviceRowUuid(deviceId: string): Promise<string> {
  return withPg(async (pg) => {
    const row = await findDeviceRow(pg, deviceId)
    if (row === null) {
      throw new Error(`[e2e] sys_device 没有 ${deviceId} 的行`)
    }
    return row.id
  })
}
