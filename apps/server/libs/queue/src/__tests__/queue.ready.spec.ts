import type { INestApplication } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { waitForQueueConnectionsReady } from '../queue.ready'

interface IFakeClient {
  status: string
}

/** 以 getQueueToken 的字符串形态索引假队列；未登记的队列抛错，模拟 Nest 的 strict 解析 */
function createFakeApp(queues: Record<string, IFakeClient[]>): INestApplication {
  return {
    get(token: string) {
      if (!(token in queues)) {
        throw new Error(`no provider for ${token}`)
      }
      return { clients: queues[token] }
    },
  } as unknown as INestApplication
}

describe('waitForQueueConnectionsReady', () => {
  it('所有已登记连接 ready 时立即返回', async () => {
    const app = createFakeApp({
      'BullQueue_app-email': [{ status: 'ready' }],
      'BullQueue_app-phone': [{ status: 'ready' }],
      'BullQueue_app-error': [{ status: 'ready' }],
    })

    await expect(waitForQueueConnectionsReady(app, 200)).resolves.toBeUndefined()
  })

  it('未在当前上下文注册的队列自动跳过', async () => {
    await expect(waitForQueueConnectionsReady(createFakeApp({}), 50)).resolves.toBeUndefined()
  })

  it('connecting 的连接会在轮询中等到 ready', async () => {
    const client: IFakeClient = { status: 'connecting' }
    const app = createFakeApp({ 'BullQueue_app-error': [client] })

    setTimeout(() => {
      client.status = 'ready'
    }, 10)

    await waitForQueueConnectionsReady(app, 500)
    expect(client.status).toBe('ready')
  })

  it('end 视为已结束，不阻塞返回', async () => {
    const app = createFakeApp({ 'BullQueue_app-error': [{ status: 'end' }] })

    await expect(waitForQueueConnectionsReady(app, 200)).resolves.toBeUndefined()
  })

  it('超时是 best-effort：连接始终不 ready 时也正常返回（不抛错），随后由 close 走 quit 路径', async () => {
    vi.useFakeTimers()
    try {
      const app = createFakeApp({ 'BullQueue_app-error': [{ status: 'connecting' }] })
      const pending = waitForQueueConnectionsReady(app, 1000)
      // 轮询间隔 5ms，推进 2s（> timeoutMs）让 deadline 判定生效
      await vi.advanceTimersByTimeAsync(2000)
      await expect(pending).resolves.toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })
})
