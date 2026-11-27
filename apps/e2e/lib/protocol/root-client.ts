import { readCredentials } from '../../scripts/env.ts'
/**
 * 已登录 root 协议客户端（模块 spec / auth 矩阵 / risk 用例共用）。
 *
 * 为什么单独成文件：`uniqueLocalIp()` + `trackDevice()` + OPAQUE 登录 + TOTP 设备验证是
 * 每个用例的**固定四步**，复制到各个 spec 里只要漏一步就会「第 5 台设备撞 42900」或
 * 「断言失败后设备没人清」。risk-support 与 system spec 都从这里取。
 *
 * `realIp` 每个客户端独立（不变量 4：device/initial 是 4 次 / 60 秒 per realIp）。
 */
import { trackDevice, uniqueLocalIp } from '../device-fixtures.ts'
import { WalnutProtocolClient } from './client.ts'

export async function rootClient(): Promise<WalnutProtocolClient> {
  const credentials = readCredentials()
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  trackDevice(client.deviceId)
  await client.login(credentials.userName, credentials.password)
  await client.verifyTotpForDevice(credentials.totpSecret)
  return client
}
