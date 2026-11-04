import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthGithubController } from '../github.controller'

/**
 * F-04 / F-05 / F-06（2026-11-01）+ 批次6-B 单测：OAuth GitHub 登录的 SSE 投递通道。
 *
 * - 订阅侧频道键 = 签名 device cookie 的 deviceId，**URL 段 fp 不参与**（旧实现里 fp 来自
 *   客户端指纹头，任何人可自选 ⇒ 抢注频道截胡 accessToken + sessionKey）；
 * - 回调侧频道键 = guard 消费 state 后挂到 `req.oauthState` 的 deviceId ——
 *   本文件的 request 桩**没有 device cookie**，所以这些用例能过本身就证明频道键
 *   不是从 cookie 回读的（批次6-B 前这里读的是 cookie）；
 * - state 缺失（guard 链被改坏）时 fail-closed：不生成令牌、不投递任何频道；
 * - 关闭事件释放的是**连接实例**（多标签页不会互相误删）；
 * - 失败分支的风控采集是 fire-and-forget，但必须自带 catch（F-05），日志里只留投递结果（F-06）。
 *
 * 为什么走单测：这四条都是「投递到哪个频道 / 异步异常有没有兜住」的决策，HTTP 层只能
 * 观察「有没有收到 token」，钉不住频道键的来源。
 */

const DEVICE_ID = 'device-0123456789abcdef'
const CLIENT_FP = 'attacker-chosen-fingerprint'
const DEVICE_CHANNEL = `oauth/github/device/${DEVICE_ID}`

interface SseStub {
  createClient: ReturnType<typeof vi.fn>
  getClientObservable: ReturnType<typeof vi.fn>
  sendToClient: ReturnType<typeof vi.fn>
}

interface Harness {
  controller: OAuthGithubController
  sse: SseStub
  close: ReturnType<typeof vi.fn>
  observable: { subscribe: ReturnType<typeof vi.fn> }
  risk: { collect: ReturnType<typeof vi.fn> }
}

function createHarness(rejectTokens = false): Harness {
  const close = vi.fn()
  const observable = { subscribe: vi.fn() }

  const sse: SseStub = {
    createClient: vi.fn(() => ({ clientId: DEVICE_CHANNEL, close })),
    getClientObservable: vi.fn(() => observable),
    sendToClient: vi.fn(() => true),
  }

  const tokens = {
    generateAuthTokens: rejectTokens
      ? vi.fn(async () => {
          throw new Error('token generation failed')
        })
      : vi.fn(async () => ({ accessToken: 'at-1', refreshTokenJti: 'jti-1', authSessionKey: 'sk-1' })),
  }

  const risk = { collect: vi.fn(async () => 1) }

  const controller = new OAuthGithubController(
    {} as never,
    tokens as never,
    sse as never,
    { setRTJtiCookie: vi.fn() } as never,
    risk as never,
    { verifyIdentity: vi.fn(async () => undefined) } as never,
    {} as never,
  )

  return { controller, sse, close, observable, risk }
}

/**
 * 回调请求桩：**故意不带 device cookie** —— 批次6-B 起回调侧的设备只来自
 * `req.oauthState.deviceId`（guard 消费 state 的产物），cookie 不参与。
 */
const request = {
  identifier: 'someone@example.com',
  realIp: '203.0.113.7',
  oauthState: { lang: 'en-US', deviceId: DEVICE_ID },
} as never

/** guard 没跑（或 guard 链被改坏）：请求上没有任何已消费的 state */
const requestWithoutState = {
  identifier: 'someone@example.com',
  realIp: '203.0.113.7',
} as never

const txContext = { em: {} } as never
const user = { userId: 'user-1' } as never
const i18n = { lang: 'en-US', t: (key: string) => `translated:${key}` } as never

afterEach(() => {
  vi.restoreAllMocks()
})

describe('oAuth github sse channel (F-04)', () => {
  it('订阅频道键只来自 device cookie：URL 段 fp 被忽略', async () => {
    const { controller, sse, close, observable } = createHarness()
    const on = vi.fn<(event: string, listener: () => void) => void>()

    const result = await controller.sse(DEVICE_ID, { on } as never, CLIENT_FP)

    expect(sse.createClient).toHaveBeenCalledWith(DEVICE_CHANNEL)
    expect(sse.getClientObservable).toHaveBeenCalledWith(DEVICE_CHANNEL)
    // 客户端可控的 fp 不得出现在任何频道键里
    expect(JSON.stringify(sse.createClient.mock.calls)).not.toContain(CLIENT_FP)
    expect(JSON.stringify(sse.getClientObservable.mock.calls)).not.toContain(CLIENT_FP)
    expect(result).toBe(observable)

    // 关闭时释放连接实例（多标签页不互相误删）
    expect(on).toHaveBeenCalledWith('close', expect.any(Function))
    on.mock.calls[0][1]()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('无 device cookie（空 deviceId）时拒绝订阅，不注册任何频道', async () => {
    const { controller, sse } = createHarness()

    await expect(controller.sse('', { on: vi.fn() } as never, CLIENT_FP)).rejects.toThrow()

    expect(sse.createClient).not.toHaveBeenCalled()
  })

  it('回调投递到 state 绑定的设备频道（request 桩没有 device cookie）', async () => {
    const { controller, sse } = createHarness()

    await controller.callback(user, txContext, request, i18n)

    expect(sse.sendToClient).toHaveBeenCalledWith(DEVICE_CHANNEL, {
      success: true,
      message: 'success',
      data: {
        event: 'token:github',
        accessToken: 'at-1',
        sessionKey: 'sk-1',
      },
    })
    // 客户端可控的 fp 不得进入投递载荷
    expect(JSON.stringify(sse.sendToClient.mock.calls)).not.toContain(CLIENT_FP)
  })

  it('guard 没有消费 state（无 req.oauthState）时 fail-closed：不生成令牌、不投递', async () => {
    const { controller, sse } = createHarness()

    await expect(controller.callback(user, txContext, requestWithoutState, i18n)).rejects.toThrow()

    expect(sse.sendToClient).not.toHaveBeenCalled()
  })

  it('失败分支也投递到设备频道，日志里只留投递结果（F-06）', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { controller, sse } = createHarness(true)

    await controller.callback(user, txContext, request, i18n)

    expect(sse.sendToClient).toHaveBeenCalledWith(DEVICE_CHANNEL, {
      success: false,
      message: 'translated:token generation failed',
      data: {},
    })

    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('sse delivered=')
  })

  it('风控采集 reject 被 catch 兜住，不产生 unhandledRejection（F-05）', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { controller, risk } = createHarness(true)

    risk.collect.mockRejectedValue(new Error('redis down'))

    await controller.callback(user, txContext, request, i18n)

    // fire-and-forget 的 catch 回调必须跑完（未兜住时 vitest 会报 unhandled rejection）
    await vi.waitFor(() => {
      expect(JSON.stringify(warn.mock.calls)).toContain('redis down')
    })
  })
})
