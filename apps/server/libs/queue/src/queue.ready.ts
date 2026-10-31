import type { INestApplication } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'

/** Bull 内部 ioredis 连接的最小形态（client / subscriber / bclient 都带 status） */
interface IWalnutAdminBullRedisClient {
  status: string
}

interface IWalnutAdminBullQueueLike {
  clients: IWalnutAdminBullRedisClient[]
}

/**
 * 等 Bull 的 ioredis 连接（client / subscriber / bclient）全部 ready。
 *
 * 为什么需要：`app.init()` 只等模块生命周期钩子完成 —— `@Processor` 的
 * bclient（阻塞取任务）与 `@OnQueue*` 的 subscriber（psubscribe）都是**惰性连接**，
 * init 返回时可能仍在握手。一次性上下文（cli 的 `openapi:export`）紧接着
 * `app.close()` 会让 ioredis 在 disconnect 时抛出未处理的
 * `Connection is closed.`（Node 24 默认 strict，进程以 1 退出且导出物不落盘）。
 *
 * 这里按连接 status 轮询到全部 ready（至多 `timeoutMs`，默认 2s），让关闭走正常的
 * quit 路径；队列未在本上下文注册（如只装配部分模块）时自动跳过。
 */
export async function waitForQueueConnectionsReady(
  app: INestApplication,
  timeoutMs = 2000,
): Promise<void> {
  const queues: IWalnutAdminBullQueueLike[] = []

  for (const name of Object.values(WalnutAdminConstAppQueue)) {
    try {
      queues.push(app.get<IWalnutAdminBullQueueLike>(getQueueToken(name), { strict: false }))
    }
    catch {
      // 未注册该队列的上下文（例如 worker 仅装配部分模块）：无需等待
    }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const clients = queues.flatMap(queue => queue.clients)
    const pending = clients.filter(client => client.status !== 'ready' && client.status !== 'end')
    if (pending.length === 0) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
