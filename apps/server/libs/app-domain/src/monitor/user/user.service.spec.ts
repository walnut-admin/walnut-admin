import type { EntityManager } from 'typeorm'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { describe, expect, it, vi } from 'vitest'
import { AppMonitorUserService } from './user.service'

/**
 * 心跳 upsert 的**行键归属**（批次 8 / B6，安全修复）。
 *
 * 改造前：`findOneAndUpdate({ visitorId: dto.visitorId }, { deviceId, ... })` —— 行键是
 * **请求体**里的 visitorId，写进那行的 deviceId 来自 Cookie。于是「把别人的 visitorId
 * 塞进 body」= 把别人那一行的 `device_id` 改成自己的设备（还能顺手覆盖 focus/left/
 * currentRouter/user_id）。
 *
 * 现在：① 行键是服务端解析的 deviceId（入参）；② 请求体的 visitorId 只作校验，判据是
 * `HMAC(visitorId) === deviceId`（与 device/initial 铸号同一条腿）；③ 请求体的 deviceId
 * 在 wire 层已被摘除，service 侧再丢一次。
 *
 * 负对照：把 filter 改回 `{ visitorId }`、把 HMAC 校验整块删掉、或把
 * `delete updatePayload.deviceId` 那行删掉，下面用例会分别红。
 */

const DEVICE_ID = 'b'.repeat(64)
const VISITOR_ID = '020ce1fb9ab27da269915faff17a6814'
const ATTACKER_VISITOR_ID = 'ffffffffffffffffffffffffffffffff'
const EM = { marker: 'entity-manager' } as unknown as EntityManager

interface IRepoCall {
  filter: Record<string, unknown>
  update: Record<string, unknown>
  options: Record<string, unknown>
}

function createService(options: { rowExists?: boolean } = {}) {
  const calls: IRepoCall[] = []

  const findOneAndUpdate = vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>, opts: Record<string, unknown>) => {
    calls.push({ filter, update, options: opts })
    return options.rowExists === false ? null : { id: 'spec-row', userId: null, left: false }
  })

  // 真实实现是 HMAC(指纹, 服务端 key)：这里用「本设备指纹 → 本设备 deviceId」的映射替身
  const getDeviceIdByFingerprint = vi.fn((fingerprint: string) =>
    fingerprint === VISITOR_ID ? DEVICE_ID : `hmac(${fingerprint})`)

  const service = new AppMonitorUserService(
    {} as never,
    { updateUserDeviceLastActiveAt: vi.fn(async () => undefined) } as never,
    {} as never,
    { updateDeviceActive: vi.fn(async () => undefined) } as never,
    { getDeviceIdByFingerprint } as never,
    { findOneAndUpdate } as never,
    {} as never,
  )

  return { service, calls, findOneAndUpdate }
}

describe('appMonitorUserService.updateState：行键是服务端 deviceId（B6）', () => {
  it('filter 按入参 deviceId（不是 body 的 visitorId）', async () => {
    const { service, calls } = createService()

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, focus: true }, EM)

    expect(calls).toHaveLength(1)
    // 旧实现这里是 { visitorId: VISITOR_ID } —— 直接就是漏洞本身（负对照）
    expect(calls[0].filter).toEqual({ deviceId: DEVICE_ID })
  })

  it('指纹不属于本设备（HMAC 对不上）⇒ 40099，且**不写库**', async () => {
    const { service, calls } = createService()

    const error = await service
      .updateState(DEVICE_ID, { visitorId: ATTACKER_VISITOR_ID, focus: true }, EM)
      .then(() => null, (e: unknown) => e)

    expect(error).toBeInstanceOf(WalnutAdminExceptionRequestDataError)
    // 旧实现会把 visitorId 当行键写进去（负对照：这里必须是零调用）
    expect(calls).toHaveLength(0)
  })

  it('请求体夹带的 deviceId 被丢弃（写集里的 deviceId 恒等于入参）', async () => {
    const { service, calls } = createService()
    const attackerDeviceId = 'a'.repeat(64)

    await service.updateState(
      DEVICE_ID,
      { visitorId: VISITOR_ID, deviceId: attackerDeviceId, focus: true },
      EM,
    )

    expect(calls[0].update.deviceId).toBe(DEVICE_ID)
  })

  it('auth=false 的显式清零仍然生效（P2-31 语义不受 B6 影响）', async () => {
    const { service, calls } = createService()

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, auth: false }, EM)

    expect(calls[0].update.userId).toBeNull()
  })

  it('行查不到（repo 返回 null）⇒ 返回 false，不抛', async () => {
    const { service } = createService({ rowExists: false })

    await expect(service.updateState(DEVICE_ID, { visitorId: VISITOR_ID }, EM)).resolves.toBe(false)
  })
})
