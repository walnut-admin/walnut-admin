import type { NestExpressApplication } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, WalnutApiClient } from './helpers/api-client'
import { createApiApp } from './helpers/create-api-app'

/**
 * G13：CAP challenge 的独立 throttle 桶（`@WalnutAdminDecoratorThrottle(SecurityCapSettingService)`）。
 *
 * `throttle.api-spec.ts` 覆盖的是 `system/device/initial` 的 4/60s 桶；CAP controller 挂的
 * 是同一守卫但动态配置源不同（`app.global.capjs.config.throttleLimit/throttleTtl`，缺省
 * 4/60s），且 @nestjs/throttler 的键按 route 生成 —— 两个桶互不占用配额。
 *
 * 独立文件的原因与 device 桶相同：本文件会打满 cap 桶 60 秒，放进 guard-matrix 会挤占其
 * 引导期的 challenge 请求（每个 WalnutApiClient 引导各消耗 1 次）。存储是内存 Map，按 app
 * 实例隔离，跨 spec 无影响。
 *
 * 计数：`WalnutApiClient.create` 已消耗 1 次（引导 challenge），本文件再发 4 次 ——
 * 前 3 次压线通过（总第 2-4 次），第 4 次（总第 5 次）→ 42900 + Retry-After。
 */

describe('G13：Throttle —— cap/challenge 4 次/60s（CAP 独立桶）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)

  async function challenge() {
    return api.unsigned('POST', api.apiPath('/security/cap/challenge'))
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app) // 引导期 challenge = 配额 1/4
  })

  afterAll(async () => {
    if (api !== undefined) {
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(api.deviceId, seed8)
    }
    await app?.close()
  })

  it('第 2-4 次连发 → challenge 成功（FreeResponse 形态：body.token 存在，无 {code,data} 壳）', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await challenge()
      const body = res.body as { token?: string, challenge?: { c: number } }
      expect(typeof body.token).toBe('string')
      expect(body.challenge?.c).toBeGreaterThan(0)
    }
  })

  it('第 5 次 → 42900（HTTP 200 壳）+ Retry-After 反映动态 blockDuration（P1-10 同款）', async () => {
    const res = await challenge()
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)

    const retryAfter = Number(res.headers['retry-after'])
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(30)
  })
})
