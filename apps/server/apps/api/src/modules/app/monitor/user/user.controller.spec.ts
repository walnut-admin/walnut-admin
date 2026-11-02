import type { AppMonitorUserService } from '@walnut-server/app-domain'
import type { AppTokenService } from '@walnut-server/token'
import type { EntityManager } from 'typeorm'
import type { AppMonitorUserDTOUpdateState } from './dto/user.dto'
import { describe, expect, it, vi } from 'vitest'
import { AppMonitorUserController } from './user.controller'

/**
 * F-47（`POST /app/monitor/user/state` 的 userId 采信口径）：该端点 Sign / JWT / CAP /
 * Device 四守卫全 Free（匿名心跳必须可用），而 `userId` 会写进 `app_monitor_user.user_id`
 * 并被在线列表 / sys_user_device / force-quit 链路消费 —— 客户端自报的值一律不可信。
 *
 * 现在的口径：只有携带**验签通过的 AT** 时才采信 AT 里的 userId；请求体里的 userId
 * 永远被覆盖（无 AT ⇒ null，service 的 nil 过滤会丢弃，匿名心跳照常更新其余字段）。
 * 本文件钉住五条：
 * 1) 无 AT：请求体伪造 userId 无效（落 null）；
 * 2) 伪造 / 过期 AT（verifyAccessToken ⇒ null）：同样无效；
 * 3) 真 AT：落 AT 里的 userId，且**覆盖**请求体里伪造的另一个 id；
 * 4) 非 Bearer 形态的头：直接忽略，不调用验签（不做无意义解析）；
 * 5) 匿名心跳的其余字段（focus / left / currentRouter / auth）原样透传、业务返回不变。
 */

const DEVICE_ID = 'spec-device'
const VICTIM_USER_ID = '11111111-1111-4111-8111-111111111111'
const ATTACKER_USER_ID = '22222222-2222-4222-8222-222222222222'
const EM = { marker: 'entity-manager' } as unknown as EntityManager

interface IVerifiedTokenPayload {
  userId: string
  userName: string
}

function createController() {
  const updateState = vi.fn<
    (deviceId: string, dto: Record<string, unknown>, em: EntityManager) => Promise<boolean>
  >(async () => true)
  const verifyAccessToken = vi.fn<
    (token: string) => Promise<IVerifiedTokenPayload | null>
  >(async () => null)

  const controller = new AppMonitorUserController(
    { updateState } as unknown as AppMonitorUserService,
    { verifyAccessToken } as unknown as AppTokenService,
  )

  return { controller, updateState, verifyAccessToken }
}

function requestWith(authorization?: string) {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as unknown as IWalnutAdminExpressRequest
}

const CTX = { em: EM }

function body(patch: Record<string, unknown> = {}) {
  return {
    visitorId: 'spec-visitor',
    currentRouter: '/dashboard',
    focus: true,
    left: false,
    ...patch,
  } as unknown as AppMonitorUserDTOUpdateState
}

function payloadOf(updateState: ReturnType<typeof vi.fn>) {
  return updateState.mock.calls[0][1] as Record<string, unknown>
}

describe('appMonitorUserController.monitor：userId 只认验签通过的 AT（F-47）', () => {
  it('无 Authorization：请求体里的 userId 被忽略（落 null），其余字段照常更新', async () => {
    const { controller, updateState } = createController()

    await controller.monitor(DEVICE_ID, CTX, requestWith(), body({ userId: VICTIM_USER_ID }))

    expect(updateState).toHaveBeenCalledOnce()
    expect(updateState.mock.calls[0][0]).toBe(DEVICE_ID)
    expect(payloadOf(updateState).userId).toBeNull()
    // 匿名心跳的其它字段不受影响
    expect(payloadOf(updateState)).toMatchObject({
      visitorId: 'spec-visitor',
      currentRouter: '/dashboard',
      focus: true,
      left: false,
    })
  })

  it('伪造 / 过期 AT（验签返回 null）：userId 同样被忽略', async () => {
    const { controller, updateState, verifyAccessToken } = createController()
    verifyAccessToken.mockResolvedValueOnce(null)

    await controller.monitor(
      DEVICE_ID,
      CTX,
      requestWith('Bearer forged-or-expired-token'),
      body({ userId: VICTIM_USER_ID }),
    )

    expect(verifyAccessToken).toHaveBeenCalledOnce()
    expect(verifyAccessToken.mock.calls[0][0]).toBe('forged-or-expired-token')
    expect(payloadOf(updateState).userId).toBeNull()
  })

  it('真 AT：落 AT 里的 userId，并**覆盖**请求体里伪造的另一个 id', async () => {
    const { controller, updateState, verifyAccessToken } = createController()
    verifyAccessToken.mockResolvedValueOnce({ userId: VICTIM_USER_ID, userName: 'victim' })

    await controller.monitor(
      DEVICE_ID,
      CTX,
      requestWith('Bearer real-access-token'),
      body({ userId: ATTACKER_USER_ID, auth: true }),
    )

    expect(payloadOf(updateState).userId).toBe(VICTIM_USER_ID)
    expect(payloadOf(updateState).auth).toBe(true)
  })

  it('非 Bearer 形态的头（Basic / 裸 token / 空串）：不调用验签，userId 落 null', async () => {
    for (const header of ['Basic dXNlcjpwYXNz', 'raw-token-without-scheme', 'Bearer ', '   ']) {
      const { controller, updateState, verifyAccessToken } = createController()

      await controller.monitor(DEVICE_ID, CTX, requestWith(header), body({ userId: VICTIM_USER_ID }))

      expect(verifyAccessToken, header).not.toHaveBeenCalled()
      expect(payloadOf(updateState).userId, header).toBeNull()
    }
  })

  it('auth=false 的登出心跳：userId 仍按 AT 结果覆盖（无 AT ⇒ null，service 的清零语义不受影响）', async () => {
    const { controller, updateState } = createController()

    await controller.monitor(DEVICE_ID, CTX, requestWith(), body({ auth: false, userId: VICTIM_USER_ID }))

    expect(payloadOf(updateState)).toMatchObject({ auth: false, userId: null })
  })

  it('updateState 的业务返回值原样透传（controller 不再二次加工）', async () => {
    const { controller, updateState } = createController()
    updateState.mockResolvedValueOnce(false)

    await expect(controller.monitor(DEVICE_ID, CTX, requestWith(), body()))
      .resolves
      .toBe(false)
  })
})
