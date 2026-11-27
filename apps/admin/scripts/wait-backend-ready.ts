/**
 * `pnpm dev`（turbo 并行起前后端）下，vite 常常先于 Nest 就绪绑好端口 —— 用户此时打开
 * 页面，`/api` 代理拿到 ECONNREFUSED 直接 502，只能等后端起来再手动刷新。
 *
 * 本脚本在 `vite` 之前轮询后端 `/health/ready`（并发探 PG / Redis 的就绪探针，真源
 * `apps/server/apps/api/src/app/probes.composition.ts`），就绪后才放行 vite —— 无论 turbo
 * 里两个 dev 任务谁先谁后，用户打开页面时后端一定可用。
 *
 * 兜底：最长等 `MAX_WAIT_MS`（默认 90s，覆盖冷启动的 SWC 编译 + nest bootstrap），超时后
 * **照常放行 vite** 并打印提醒 —— 等待失败绝不把 dev 卡死，只是退回原来的「刷新一次」体验。
 * 目标地址可用 `ADMIN_DEV_READY_URL` 覆盖（默认值与 `VITE_PROXY` 的 target 同源：127.0.0.1:3000）。
 */
import process from 'node:process'

const READY_URL = process.env.ADMIN_DEV_READY_URL ?? 'http://127.0.0.1:3000/health/ready'
const POLL_INTERVAL_MS = 500
const MAX_WAIT_MS = Number(process.env.ADMIN_DEV_MAX_WAIT_MS ?? 90_000)

const startedAt = Date.now()

function log(message: string): void {
  console.log(`[wait-backend-ready] ${message}`)
}

async function isBackendReady(): Promise<boolean> {
  try {
    // /health/ready 就绪时返回 2xx；503（PG/Redis 未就绪）或连接拒绝都算「未就绪」
    const response = await fetch(READY_URL, { signal: AbortSignal.timeout(1500) })
    return response.ok
  }
  catch {
    return false
  }
}

const ready = await isBackendReady()
if (ready) {
  log(`后端已就绪（${READY_URL}）`)
  process.exit(0)
}

log(`后端未就绪，开始等待（${READY_URL}，最长 ${MAX_WAIT_MS / 1000}s）…`)

while (Date.now() - startedAt < MAX_WAIT_MS) {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

  if (await isBackendReady()) {
    log(`后端已就绪（等待 ${((Date.now() - startedAt) / 1000).toFixed(1)}s），启动 vite`)
    process.exit(0)
  }
}

log(`等待超时（${MAX_WAIT_MS / 1000}s）——按原行为继续启动 vite；后端起来后请手动刷新页面`)
