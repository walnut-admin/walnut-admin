import type { EntityManager } from 'typeorm'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { describe, expect, it, vi } from 'vitest'
import { AppMonitorUserService } from '../user.service'

/**
 * 心跳 upsert 的**行键归属**（批次 8 / B6）+ **visitorId 校验口径**（批次 11 / B5 收尾）。
 *
 * 行键：改造前是**请求体**的 visitorId，写进行里的 deviceId 来自 Cookie —— 于是「把别人的
 * visitorId 塞进 body」= 把别人那一行的 device_id 改成自己的设备（还能顺手覆盖 focus /
 * left / currentRouter / user_id）。现在行键是服务端解析的 deviceId（入参）。
 *
 * visitorId 校验：批次 8 用 `HMAC(visitorId) === deviceId`（可计算），但 B5 把 deviceId 改成
 * **服务端随机签发**后该等式对真实客户端**恒假** ⇒ 每次心跳被自己拒成 40099。现在照 wire
 * DTO 注释本来的口径改「与**本设备已存行**的 visitor_id 比」：
 * - 行不存在（首写）⇒ 放行，以请求里的 visitorId 落库；
 * - 行存在且不同 ⇒ 40099，且**不写库**。
 *
 * 负对照（改下面任一处，用例会红）：
 * - 把 filter 改回 `{ visitorId }`（第 1 例）；
 * - 删掉「已存行不同即拒」那段（第 2 例）；
 * - 把首写也一律拒绝（第 3 例）；
 * - 把 `delete updatePayload.deviceId` 那行删掉（第 4 例）。
 */

const DEVICE_ID = `d1_${'b'.repeat(32)}`
const VISITOR_ID = '020ce1fb9ab27da269915faff17a6814'
const ATTACKER_VISITOR_ID = 'ffffffffffffffffffffffffffffffff'
const EM = { marker: 'entity-manager' } as unknown as EntityManager

interface IRepoCall {
  filter: Record<string, unknown>
  update: Record<string, unknown>
  options: Record<string, unknown>
}

function createService(options: { rowExists?: boolean, boundVisitorId?: string } = {}) {
  const calls: IRepoCall[] = []

  const findOneAndUpdate = vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>, opts: Record<string, unknown>) => {
    calls.push({ filter, update, options: opts })
    return options.rowExists === false ? null : { id: 'spec-row', userId: null, left: false }
  })

  // 首写时序：行还不存在 ⇒ null（不参与校验）；行存在时返回「这台设备已登记的指纹」
  const findFirstByDeviceId = vi.fn(async () =>
    options.boundVisitorId === undefined ? null : { visitorId: options.boundVisitorId })

  const service = new AppMonitorUserService(
    {} as never,
    { updateUserDeviceLastActiveAt: vi.fn(async () => undefined) } as never,
    {} as never,
    { updateDeviceActive: vi.fn(async () => undefined) } as never,
    {} as never,
    { findOneAndUpdate, findFirstByDeviceId } as never,
    {} as never,
  )

  return { service, calls, findOneAndUpdate, findFirstByDeviceId }
}

describe('appMonitorUserService.updateState：行键是服务端 deviceId（B6）+ visitorId 与本设备已存行比（B5 收尾）', () => {
  it('filter 按入参 deviceId（不是 body 的 visitorId）', async () => {
    const { service, calls } = createService()

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, focus: true }, EM)

    expect(calls).toHaveLength(1)
    // 旧实现这里是 { visitorId: VISITOR_ID } —— 直接就是漏洞本身（负对照）
    expect(calls[0].filter).toEqual({ deviceId: DEVICE_ID })
  })

  it('首写（本设备还没有行）⇒ 放行，且 body 的 visitorId 随首行登记落库', async () => {
    const { service, calls } = createService()

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, auth: true }, EM)

    expect(calls).toHaveLength(1)
    expect(calls[0].update.visitorId).toBe(VISITOR_ID)
  })

  it('已存行的指纹与 body 不一致 ⇒ 40099，且**不写库**', async () => {
    // 这台设备第一次心跳就登记了 VISITOR_ID；第二次带别人的指纹 ⇒ 拒
    const { service, calls } = createService({ boundVisitorId: VISITOR_ID })

    const error = await service
      .updateState(DEVICE_ID, { visitorId: ATTACKER_VISITOR_ID, focus: true }, EM)
      .then(() => null, (e: unknown) => e)

    expect(error).toBeInstanceOf(WalnutAdminExceptionRequestDataError)
    // 拒绝必须发生在写库之前（负对照：这里必须是零调用）
    expect(calls).toHaveLength(0)
  })

  it('已存行的指纹与 body 一致 ⇒ 正常 upsert（真实客户端的心跳）', async () => {
    const { service, calls } = createService({ boundVisitorId: VISITOR_ID })

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, focus: true }, EM)

    expect(calls).toHaveLength(1)
    expect(calls[0].filter).toEqual({ deviceId: DEVICE_ID })
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

  it('auth=false 的显式清零仍然生效（P2-31 语义不受影响）', async () => {
    const { service, calls } = createService()

    await service.updateState(DEVICE_ID, { visitorId: VISITOR_ID, auth: false }, EM)

    expect(calls[0].update.userId).toBeNull()
  })

  it('行查不到（repo 返回 null）⇒ 返回 false，不抛', async () => {
    const { service } = createService({ rowExists: false })

    await expect(service.updateState(DEVICE_ID, { visitorId: VISITOR_ID }, EM)).resolves.toBe(false)
  })
})
