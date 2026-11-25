/**
 * 前置检查：**在 DROP DATABASE 之前**确认这一轮跑得起来。
 *
 * 为什么要它在最前面：prepare-db 的第一步就是重建库。之前的顺序是「先删库、再发现
 * .env.stage 没解密 / 产物没构建 / 4173 被残留进程占着」—— 库白重建一次，而且报错发生在
 * `playwright test` 的 webServer 超时里，看不出根因。这一层把这类失败**集中到一次**打印，
 * 并统一以退出码 **2**（环境没准备好）收场。
 *
 * 检查面与处置：
 * - stage env（`apps/server/env-local/.env.stage`，含 `AUTH_OPAQUE_SECRET` 一项）→ `pnpm setup-env`；
 * - 两处 stage 产物（admin `dist-staging/index.html`、server `dist-stage/apps/api/src/main.js`）
 *   → `pnpm walnut build:stage` / `pnpm --filter @walnut/server build:stage`；
 * - PG 5433 / Redis 6380 TCP 可达 → 起数据栈（apps/e2e/README.md 的「数据栈的两种形态」）；
 * - 3001 / 3002 / 4173 空闲 → 停掉残留进程（README「排障」的最后一条）；
 * - Playwright 的 chromium 已安装 → `pnpm --filter @walnut/e2e exec playwright install chromium`。
 *
 * 刻意**不查**的东西：库里的表 / seed 状态（prepare-db 会重建，不需要「已经准备好」）、
 * 外网连通性（只有 @network 用例依赖它）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import {
  ADMIN_INDEX_FILE,
  BACKEND_PORT,
  E2E_PG_HOST,
  E2E_PG_PORT,
  E2E_REDIS_HOST,
  E2E_REDIS_PORT,
  parseEnvFile,
  SERVER_MAIN_FILE,
  SERVER_STAGE_ENV_FILE,
  SOCKET_PORT,
  WEB_PORT,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'

interface CheckResult {
  name: string
  ok: boolean
  detail: string
  /** 失败时的处置提示（成功时为 undefined） */
  fix?: string
}

const DATA_STACK_FIX = '起数据栈：apps/e2e/README.md「数据栈的两种形态」（WSL 形态还要保持一个隐藏会话，见「WSL 的生命周期」）'
const PORTS_FIX = '先停掉占用它的残留进程（apps/e2e/README.md「排障」最后一条：netstat -ano | findstr :<端口>）'

function checkTcp(host: string, port: number): Promise<{ ok: boolean, detail: string }> {
  return new Promise((resolve) => {
    let settled = false
    const socket = connect({ host, port })

    const finish = (ok: boolean, detail: string): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve({ ok, detail })
    }

    socket.setTimeout(3_000, () => finish(false, '3s 内没有建立连接（超时）'))
    socket.once('connect', () => finish(true, '可达'))
    socket.once('error', (error: NodeJS.ErrnoException) => finish(false, error.code ?? error.message))
  })
}

function checkPortFree(port: number): Promise<{ ok: boolean, detail: string }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean, detail: string): void => {
      if (settled) {
        return
      }
      settled = true
      resolve({ ok, detail })
    }

    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => finish(false, `被占用（${error.code ?? error.message}）`))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => finish(true, '空闲'))
    })
  })
}

function checkStageEnv(): CheckResult {
  if (!existsSync(SERVER_STAGE_ENV_FILE)) {
    return {
      name: 'stage env',
      ok: false,
      detail: `缺 ${SERVER_STAGE_ENV_FILE}`,
      fix: 'pnpm setup-env（解密 env-encrypted/ → env-local/，需要根 .env.keys）',
    }
  }

  const env = parseEnvFile(readFileSync(SERVER_STAGE_ENV_FILE, 'utf8'))
  if ((env.AUTH_OPAQUE_SECRET ?? '') === '') {
    return {
      name: 'stage env',
      ok: false,
      detail: `${SERVER_STAGE_ENV_FILE} 里没有 AUTH_OPAQUE_SECRET（seed 的 --admin 口令身份必须与它同源）`,
      fix: 'pnpm setup-env 重新解密（文件可能被截断 / 模板过旧）',
    }
  }

  return { name: 'stage env', ok: true, detail: SERVER_STAGE_ENV_FILE }
}

function checkArtifact(name: string, file: string, fix: string): CheckResult {
  return existsSync(file)
    ? { name, ok: true, detail: file }
    : { name, ok: false, detail: `缺 ${file}`, fix }
}

function checkChromium(): CheckResult {
  try {
    const executable = chromium.executablePath()
    return existsSync(executable)
      ? { name: 'playwright chromium', ok: true, detail: executable }
      : {
          name: 'playwright chromium',
          ok: false,
          detail: `缺 ${executable}`,
          fix: 'pnpm --filter @walnut/e2e exec playwright install chromium',
        }
  }
  catch (error) {
    return {
      name: 'playwright chromium',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fix: 'pnpm --filter @walnut/e2e exec playwright install chromium',
    }
  }
}

/**
 * 跑全部前置检查；任一失败就抛 {@link E2ePreconditionError}（进程退 2），
 * 消息里带上**所有**失败的检查 —— 一次改完，不用来回试。
 */
export async function runPreflight(): Promise<void> {
  const results: CheckResult[] = [
    checkStageEnv(),
    checkArtifact('admin 产物', ADMIN_INDEX_FILE, 'pnpm walnut build:stage'),
    checkArtifact('server 产物', SERVER_MAIN_FILE, 'pnpm --filter @walnut/server build:stage'),
    checkChromium(),
  ]

  for (const service of [
    { name: `PG ${E2E_PG_HOST}:${E2E_PG_PORT} 可达`, host: E2E_PG_HOST, port: E2E_PG_PORT },
    { name: `Redis ${E2E_REDIS_HOST}:${E2E_REDIS_PORT} 可达`, host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
  ]) {
    const tcp = await checkTcp(service.host, service.port)
    results.push({ name: service.name, ok: tcp.ok, detail: tcp.detail, fix: tcp.ok ? undefined : DATA_STACK_FIX })
  }

  for (const port of [BACKEND_PORT, SOCKET_PORT, WEB_PORT]) {
    const free = await checkPortFree(port)
    results.push({ name: `端口 ${port} 空闲`, ok: free.ok, detail: free.detail, fix: free.ok ? undefined : PORTS_FIX })
  }

  for (const result of results) {
    console.log(`[e2e/preflight] ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}：${result.detail}`)
  }

  const failed = results.filter(result => !result.ok)
  if (failed.length > 0) {
    const detail = failed
      .map(result => `  - ${result.name}：${result.detail}\n    处置：${result.fix ?? '（未给提示）'}`)
      .join('\n')
    throw new E2ePreconditionError(`前置条件没准备好（${failed.length} 项），环境问题不跑用例：\n${detail}`)
  }

  console.log('[e2e/preflight] 全部通过')
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  runPreflight().catch((error) => {
    console.error(`[e2e/preflight] 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  })
}
