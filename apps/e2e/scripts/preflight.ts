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
 * - **PG 容器可读**（P1-1）：基线 dump / restore 要 `docker exec` 进容器；`E2E_SKIP_BASELINE=1`
 *   时跳过。失败信息给出两种 compose 的启动命令与 `E2E_PG_CONTAINER` 覆盖方式；
 * - 3001 / 3002 / 4173 空闲 → 停掉残留进程（README「排障」的最后一条）；
 * - Playwright 的 chromium 已安装 → `pnpm --filter @walnut/e2e exec playwright install chromium`；
 * - **产物新鲜度**（`scripts/freshness.ts`）：两处 stage 产物是否旧于最近一次源码提交 ——
 *   这一类**只警告不退出**（存在「故意验证旧产物」的合法用法），读数另由 stack.json 记录。
 *
 * 刻意**不查**的东西：库里的表 / seed 状态（prepare-db 会重建，不需要「已经准备好」）、
 * 外网连通性（只有 @network 用例依赖它）、数据路径脏状态（那是基线决策的事，见 baseline.ts）。
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
  REPO_ROOT,
  SERVER_MAIN_FILE,
  SERVER_STAGE_ENV_FILE,
  SOCKET_PORT,
  WEB_PORT,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'
import { computeArtifactFreshness, staleArtifacts } from './freshness.ts'
import { inspectPgContainer, resolvePgContainer, toWslPath } from './pg-container.ts'

interface CheckResult {
  name: string
  ok: boolean
  detail: string
  /** 失败时的处置提示（成功时为 undefined） */
  fix?: string
}

const DATA_STACK_FIX = '起数据栈：apps/e2e/README.md「数据栈的两种形态」（WSL 形态还要保持一个隐藏会话，见「WSL 的生命周期」）'
const PORTS_FIX = '先停掉占用它的残留进程（apps/e2e/README.md「排障」最后一条：netstat -ano | findstr :<端口>）'
const PG_CONTAINER_FIX = [
  '起数据栈（两种 compose 任一）：',
  `  通用形态（Docker Desktop / 原生 Linux）：docker compose -f apps/e2e/docker-compose.yml up -d`,
  `  WSL 形态（本机）：wsl -e bash -c "docker compose -f ${toWslPath(path.join(REPO_ROOT, 'apps/e2e/docker-compose.wsl.yml'))} up -d"`,
  '容器名不是默认值时用 E2E_PG_CONTAINER=<容器名>（默认 e2e-wsl-postgres；通用 compose 是 e2e-postgres）',
  'Windows + Docker Desktop 用 E2E_PG_EXEC_MODE=docker 改走原生 docker CLI',
].join('\n')

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

/** 基线 dump / restore 的容器可读性（P1-1）；跳过基线的运行（CI / 逃生口）不查 */
function checkPgContainer(): CheckResult {
  const name = 'PG 容器（基线 dump / restore）'
  if (process.env.E2E_SKIP_BASELINE === '1') {
    return { name, ok: true, detail: 'E2E_SKIP_BASELINE=1：本轮不封板 / 不恢复，跳过' }
  }
  const container = resolvePgContainer()
  const inspection = inspectPgContainer(container)
  return inspection.ok
    ? { name, ok: true, detail: inspection.detail }
    : { name, ok: false, detail: inspection.detail, fix: PG_CONTAINER_FIX }
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
 * 产物新鲜度：**只警告、不退出**（口径与「为什么」见 scripts/freshness.ts 的文件头）。
 *
 * 打印在其它检查之前：如果后面报「登录框等不出来」这类失败，先看到这一行就知道该先重建产物，
 * 而不是去查产品逻辑。
 */
function warnStaleArtifacts(): void {
  const freshness = computeArtifactFreshness()
  if (freshness.sourceCommitSeconds === null) {
    console.log('[e2e/preflight] WARN 产物新鲜度：读不到 git 提交时刻（浅克隆 / 非 git 环境），跳过比较')
    return
  }

  const notes = staleArtifacts(freshness)
  if (notes.length === 0) {
    console.log(`[e2e/preflight] ok   产物新鲜度：不旧于最近一次源码提交（${freshness.sourceCommitAt ?? '未知'}）`)
    return
  }

  for (const note of notes) {
    console.log(
      `[e2e/preflight] WARN 产物落后源码：${note.name} 落后 ${note.lagMinutes} 分钟`
      + `（处置：${note.fix}；只警告，本轮可能跑的是旧产物）`,
    )
  }
}

/**
 * 跑全部前置检查；任一失败就抛 {@link E2ePreconditionError}（进程退 2），
 * 消息里带上**所有**失败的检查 —— 一次改完，不用来回试。
 */
export async function runPreflight(): Promise<void> {
  warnStaleArtifacts()

  const results: CheckResult[] = [
    checkStageEnv(),
    checkArtifact('admin 产物', ADMIN_INDEX_FILE, 'pnpm walnut build:stage'),
    checkArtifact('server 产物', SERVER_MAIN_FILE, 'pnpm --filter @walnut/server build:stage'),
    checkChromium(),
    checkPgContainer(),
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
