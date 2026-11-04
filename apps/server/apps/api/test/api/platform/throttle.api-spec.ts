import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../helpers/api-client'
import { createApiApp } from '../helpers/create-api-app'

/**
 * F 段：限流 Throttle —— `POST /system/device/initial` 的 @WalnutAdminDecoratorThrottle
 * 动态覆盖（SysDeviceSettingService：limit=4 / ttl=60s，硬编码非 settings），tracker 是
 * `req.realIp`（本进程内恒 127.0.0.1）。存储是 @nestjs/throttler 默认内存 Map —— **按 app
 * 实例隔离**，因此本文件的连发不会影响其他 spec（每份 spec 自建 app），但要精确控制本文件
 * 内的配额：引导期 WalnutApiClient.create 已消耗 1 次，本文件再发 3 次压线通过，第 5 次 429。
 *
 * 独立成文件的原因：连发会占用同 IP 的 60s 配额，放主矩阵文件会挤占其他用例的引导请求。
 * 429 的响应形态经全局异常过滤器统一：**HTTP 200 + body.code 42900**（TOO_MANY_REQUESTS，
 * 原生 ThrottlerException 429 由 handler 映射，钉现状）。
 */
describe('F 段：Throttle —— device/initial 4 次/60s（动态覆盖 + 内存存储按 app 隔离）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const createdDeviceIds: string[] = []

  async function deviceInitial(fingerprint: string): Promise<SuperTestResponse> {
    return api.unsigned(
      'POST',
      api.apiPath('/system/device/initial'),
      {
        // device_name 有唯一约束（uq_device_name）：名字必须逐次唯一，重复名撞 23505 后被
        // service 的 catch-all 吞掉改抛 40605（本专项实测：截断指纹作名字时会踩中）
        // B5 / P4：deviceName 由服务端生成，请求面不再带（带上来即 40099）
        deviceInfo: {},
        hardwareInfo: {},
        sr: { height: 1080, width: 1920 },
        vp: { height: 900, width: 1600 },
        private: false,
      },
      { 'X-Fingerprint': fingerprint },
    )
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app) // 引导期 initial = 配额 1/4
  })

  afterAll(async () => {
    if (api !== undefined) {
      const deviceIds = [api.deviceId, ...createdDeviceIds]
      for (const deviceId of deviceIds) {
        await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
        await api.cleanupWalnutCacheKeys(deviceId)
      }
      await api.cleanupWalnutCacheKeys(seed8)
    }
    await app?.close()
  })

  it('第 2-4 次连发 → 20000（limit=4/ttl=60s 动态覆盖压线通过，新指纹各落新设备行）', async () => {
    for (let i = 0; i < 3; i++) {
      const fingerprint = `throttle-${seed8}-${i}`
      const res = await deviceInitial(fingerprint)
      expectOk(res, `initial #${i + 2}`)
      createdDeviceIds.push(bodyOf<{ deviceId: string }>(res).data.deviceId)
    }
    expect(createdDeviceIds).toHaveLength(3)
  })

  it('第 5 次 → 42900（HTTP 200 壳）+ Retry-After 反映动态 blockDuration（P1-10）', async () => {
    const res = await deviceInitial(`throttle-${seed8}-over`)
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)

    // P1-10：动态覆盖把 blockDuration 同步为动态 ttl（60s）。ThrottlerStorage 的
    // timeToBlockExpire 以秒回填 Retry-After —— 修复前 blockDuration 仍是全局 ttl（10s），
    // 此处会 ≈10；修复后 ≈60。断言 ≥30 区分两态（封禁窗口远大于 10s）。
    const retryAfter = Number(res.headers['retry-after'])
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(30)
  })
})
