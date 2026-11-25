import type { PgExecMode } from './pg-container.ts'
/**
 * 数据栈（独立 PG + Redis）的生命周期入口：`pnpm walnut e2e:stack:up|down|status`。
 *
 * 它**只管数据栈**：不抢 run 级锁、不碰库、不启后端 / 静态代理 / Playwright ——
 * 那些是 `scripts/run.ts` 的编排（见该文件头的硬顺序）。存在意义是 P2-5 的「一条命令看
 * 数据栈状态」：先确认 5433 / 6380 与两个容器就绪，再决定要不要跑 e2e；down / up 也不必
 * 每次手抄两条 compose 命令（WSL 形态的路径还要换成 `/mnt/<盘符>/…`）。
 *
 * 形态选择（与 `scripts/pg-container.ts` 同一口径，不另立判断）：
 * - `E2E_PG_EXEC_MODE=wsl`（win32 缺省）⇒ WSL 常驻栈 `docker-compose.wsl.yml`；
 * - `E2E_PG_EXEC_MODE=docker`（缺省按平台：原生 Linux / macOS 走这条）⇒ 通用栈 `docker-compose.yml`；
 * - `E2E_PG_CONTAINER` 显式给了通用 compose 的容器名（`e2e-postgres`）时，按通用栈处理 ——
 *   否则 `down` 会去停一份根本没在跑的 WSL 项目。
 *
 * 容器名与 compose 文件逐字对齐两份 compose；改其中一份必须同时改这里与 `scripts/env.ts`。
 * 所有子进程都 `windowsHide: true`（本机禁止弹可见窗口；WSL 投递天然无窗口）。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { baselineUsable } from './baseline.ts'
import {
  BACKEND_PORT,
  E2E_PG_HOST,
  E2E_PG_PORT,
  E2E_REDIS_HOST,
  E2E_REDIS_PORT,
  E2E_ROOT,
  SOCKET_PORT,
  WEB_PORT,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'
import { inspectContainer, resolvePgExecMode, toWslPath } from './pg-container.ts'
import { checkPortFree, checkTcp } from './preflight.ts'

export type StackShape = 'wsl' | 'generic'

export interface StackTarget {
  shape: StackShape
  /** compose 文件的绝对路径（WSL 投递时换成 `/mnt/…`） */
  composeFile: string
  /** compose 项目名（两份 compose 的 `name:`；`down` 只停跑的那一份） */
  projectName: string
  pgContainer: string
  redisContainer: string
  /** 命令投递形态（来自 `resolvePgExecMode`，与 preflight 的容器检查同源） */
  execMode: PgExecMode
}

/** WSL 常驻栈的容器名（`docker-compose.wsl.yml`） */
export const WSL_PG_CONTAINER = 'e2e-wsl-postgres'
export const WSL_REDIS_CONTAINER = 'e2e-wsl-redis'
/** 通用栈的容器名（`docker-compose.yml`） */
export const GENERIC_PG_CONTAINER = 'e2e-postgres'
export const GENERIC_REDIS_CONTAINER = 'e2e-redis'

const COMPOSE_FILES: Record<StackShape, string> = {
  wsl: path.join(E2E_ROOT, 'docker-compose.wsl.yml'),
  generic: path.join(E2E_ROOT, 'docker-compose.yml'),
}

const PROJECT_NAMES: Record<StackShape, string> = {
  wsl: 'walnut-e2e-wsl',
  generic: 'walnut-e2e',
}

/**
 * 形态判定（纯函数，单测直击）。
 *
 * 优先级：
 * 1. `E2E_PG_CONTAINER` 恰好是通用 compose 的容器名 ⇒ 通用栈（见文件头）；
 * 2. `E2E_PG_CONTAINER` 恰好是 WSL compose 的容器名 ⇒ WSL 栈；
 * 3. 其余按 `E2E_PG_EXEC_MODE` / 平台（`resolvePgExecMode`，非法值照旧抛前置错误）。
 */
export function resolveStackShape(
  platform: NodeJS.Platform,
  execModeOverride: string | undefined,
  explicitContainer: string | undefined,
): StackShape {
  const container = (explicitContainer ?? '').trim()
  if (container === GENERIC_PG_CONTAINER) {
    return 'generic'
  }
  if (container === WSL_PG_CONTAINER) {
    return 'wsl'
  }
  return resolvePgExecMode(platform, execModeOverride) === 'wsl-bash' ? 'wsl' : 'generic'
}

/** 按形态拼出目标（容器名可用 `E2E_PG_CONTAINER` 覆盖 PG 一项；Redis 跟随 compose 文件） */
export function stackTargetOf(shape: StackShape, execMode: PgExecMode, explicitContainer?: string): StackTarget {
  const trimmed = (explicitContainer ?? '').trim()
  const pgContainer = trimmed !== ''
    ? trimmed
    : shape === 'wsl' ? WSL_PG_CONTAINER : GENERIC_PG_CONTAINER
  return {
    shape,
    composeFile: COMPOSE_FILES[shape],
    projectName: PROJECT_NAMES[shape],
    pgContainer,
    redisContainer: shape === 'wsl' ? WSL_REDIS_CONTAINER : GENERIC_REDIS_CONTAINER,
    execMode,
  }
}

/**
 * compose 子命令的 argv（纯函数）。
 *
 * WSL 形态把整段脚本交给 `bash -c`：路径必须是 `/mnt/<盘符>/…`，参数只来自本文件的白名单
 * （up / down / -d / -v），没有外部输入拼进来的位置。
 */
export function composeArgv(target: StackTarget, args: readonly string[]): string[] {
  if (target.execMode === 'wsl-bash') {
    const script = ['docker', 'compose', '-f', `'${toWslPath(target.composeFile)}'`, ...args].join(' ')
    return ['wsl', '-e', 'bash', '-c', script]
  }
  return ['docker', 'compose', '-f', target.composeFile, ...args]
}

function log(message: string): void {
  console.log(`[e2e/stack] ${message}`)
}

function runCompose(target: StackTarget, args: readonly string[]): void {
  const argv = composeArgv(target, args)
  const result = spawnSync(argv[0]!, argv.slice(1), { stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) {
    throw new E2ePreconditionError(
      `compose 命令没跑起来（${argv[0]}）：${result.error.message}\n`
      + '  WSL 形态确认 wsl 可执行且发行版在跑；Docker Desktop 形态确认 docker CLI 在 PATH 上，'
      + '并用 E2E_PG_EXEC_MODE=docker 显式改走原生 docker（见 apps/e2e/README.md「数据栈的两种形态」）。',
    )
  }
  if (result.status !== 0) {
    throw new E2ePreconditionError(
      `compose 命令失败（exit ${result.status ?? 'signal'}）：${argv.join(' ')}\n`
      + '  数据栈的两种形态与容器名见 apps/e2e/README.md；E2E_PG_CONTAINER / E2E_PG_EXEC_MODE 可覆盖容器名与投递方式。',
    )
  }
}

/** 解析当前应管理的栈（形态 → 目标；`E2E_PG_CONTAINER` 覆盖 PG 容器名） */
export function detectStackTarget(): StackTarget {
  const explicit = process.env.E2E_PG_CONTAINER
  const shape = resolveStackShape(process.platform, process.env.E2E_PG_EXEC_MODE, explicit)
  const execMode = resolvePgExecMode(process.platform, process.env.E2E_PG_EXEC_MODE)
  return stackTargetOf(shape, execMode, explicit)
}

function describeTarget(target: StackTarget): void {
  log(
    `形态：${target.shape === 'wsl' ? 'WSL 常驻栈' : '通用栈'}（${path.relative(process.cwd(), target.composeFile)}；`
    + `compose 项目 ${target.projectName}；投递 ${target.execMode}）`,
  )
}

/** 基线状态一句话（复用 `baselineUsable` 的判定，不在这里重算 dataKey） */
export function baselineStatusLine(): string {
  try {
    const usage = baselineUsable()
    switch (usage.kind) {
      case 'usable':
        return `可用（封板于 ${usage.manifest.sealedAt}，迁移头 ${usage.manifest.migrationsHead.id}，菜单 ${usage.manifest.menuRows} 行）`
      case 'missing':
        return '没有基线（首次运行会全量 prepare 并自动封板）'
      case 'invalid':
        return `不可用：${usage.reason}`
      case 'drifted': {
        const dirty = usage.dirtyPaths.length > 0 ? `；数据路径有未提交改动 ${usage.dirtyPaths.length} 项` : ''
        return `漂移（dataKey ${usage.dataKey.slice(0, 12)}… 与清单不一致${dirty}）—— 用 --rebuild-baseline 重新封板`
      }
    }
  }
  catch (error) {
    return `读取失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function status(): Promise<void> {
  const target = detectStackTarget()
  describeTarget(target)

  for (const container of [target.pgContainer, target.redisContainer]) {
    const inspection = inspectContainer(container)
    log(`${inspection.ok ? 'ok  ' : 'FAIL'} ${inspection.detail}`)
  }

  for (const service of [
    { name: `PG ${E2E_PG_HOST}:${E2E_PG_PORT}`, host: E2E_PG_HOST, port: E2E_PG_PORT },
    { name: `Redis ${E2E_REDIS_HOST}:${E2E_REDIS_PORT}`, host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
  ]) {
    const tcp = await checkTcp(service.host, service.port)
    log(`${tcp.ok ? 'ok  ' : 'FAIL'} ${service.name}：${tcp.detail}`)
  }

  for (const port of [BACKEND_PORT, SOCKET_PORT, WEB_PORT]) {
    const free = await checkPortFree(port)
    log(`info 端口 ${port}：${free.ok
      ? '空闲（Playwright 会自己起后端 / 静态代理）'
      : `被占用（${free.detail}）—— 默认配置会按退出码 2 失败；确认是本轮产物才用 E2E_REUSE_SERVER=1`}`)
  }

  log(`基线：${baselineStatusLine()}`)
  log('status 只读：不抢锁、不动库、不启停任何服务（退出码恒 0）')
}

async function up(): Promise<void> {
  const target = detectStackTarget()
  describeTarget(target)
  log(`启动：docker compose -f ${target.composeFile} up -d`)
  runCompose(target, ['up', '-d'])
  log('已发出启动命令；等两个容器 healthy 用 `pnpm walnut e2e:stack:status` 复查')
}

async function down(args: readonly string[]): Promise<void> {
  const unknown = args.filter(arg => arg !== '--volumes' && arg !== '-v')
  if (unknown.length > 0) {
    throw new E2ePreconditionError(
      `e2e:stack:down 不认识的参数：${unknown.join(' ')}（只接受 --volumes / -v：连数据卷一起删）`,
    )
  }
  const volumes = args.includes('--volumes') || args.includes('-v')
  const target = detectStackTarget()
  describeTarget(target)
  log(`停止：docker compose -f ${target.composeFile} down${volumes ? ' -v（连数据卷一起删）' : '（保留数据卷）'}`)
  runCompose(target, volumes ? ['down', '-v'] : ['down'])
  log(volumes
    ? '已停止并删除数据卷：下次 up 是全新的空实例（基线随之失效，首次 run 会全量 prepare 并重新封板）'
    : '已停止（数据卷保留）；下次 up 后数据还在')
}

/** 入口：`node scripts/stack.ts up|down|status [--volumes]` */
async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2)
  switch (action) {
    case 'up':
      await up()
      return
    case 'down':
      await down(rest)
      return
    case 'status':
      await status()
      return
    default:
      throw new E2ePreconditionError(
        `用法：node scripts/stack.ts up|down|status [--volumes]\n`
        + '  对应 `pnpm walnut e2e:stack:up` / `e2e:stack:down` / `e2e:stack:status`（-- 之后可传 --volumes）',
      )
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[e2e/stack] 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = error instanceof E2ePreconditionError ? 2 : 1
  })
}
