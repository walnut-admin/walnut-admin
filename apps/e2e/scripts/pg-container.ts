/**
 * 基线 dump / restore 的**容器执行层**：容器名参数化 + 平台感知 + 可读性检查。
 *
 * 为什么单独一层：
 * - `baseline.ts` 只该关心「封板 / 恢复的语义」，不该关心「怎么把命令送进容器」；
 * - `preflight.ts` 要在**动库之前**确认容器可读（失败信息给两种 compose 的启动命令），
 *   又不想为此把 prepare-db / pg / redis 整条依赖链拖进来（本文件只依赖 env + failure）。
 *
 * 平台感知（P1-1）：
 * - **win32**：本机数据栈在 WSL 的 Docker 里，命令经 `wsl -e bash -c "docker exec …"` 执行 ——
 *   `wsl.exe` 天然无窗口（本机禁止弹可见终端）；
 * - **其它平台（原生 Linux / macOS）**：直接 `docker exec …`（argv 直传，不经 shell）。
 *
 * 容器名：默认 `e2e-wsl-postgres`（本机 WSL 栈），用 `E2E_PG_CONTAINER` 覆盖 ——
 * 通用 compose（`apps/e2e/docker-compose.yml`）的容器名是 `e2e-postgres`。
 * Windows + Docker Desktop 这类「平台是 win32、但 docker CLI 在 Windows 侧」的机器，用
 * `E2E_PG_EXEC_MODE=docker` 显式改走原生 docker（默认 `auto` 仍按平台判断）。
 */
import type { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { E2E_PG_DB, E2E_PG_USER } from './env.ts'
import { E2ePreconditionError } from './failure.ts'

/** 默认容器名（WSL 常驻栈；见 apps/e2e/README.md 的「数据栈的两种形态」） */
export const DEFAULT_PG_CONTAINER = 'e2e-wsl-postgres'
/**
 * CI 的 services 容器名由 runner 生成、不可预知 —— 与 workflow 里给 Redis 设口令那一步
 * 同一手法：按镜像名找（`docker ps -q --filter ancestor=…`）。只在 `CI=true` 且非 WSL 投递时
 * 启用，本地永远不会因为默认容器不在就顺手挑一个别的 postgres 容器。
 */
const CI_PG_IMAGE = 'postgres:18-alpine'
/** 命令兜底超时：正常是秒级；卡住时别让整轮无限等 */
const PG_EXEC_TIMEOUT_MS = 120_000
/** `docker inspect` 只需要秒级；容器在但 Docker 响应慢时也别拖住 preflight */
const INSPECT_TIMEOUT_MS = 20_000

/**
 * 容器名白名单。容器名会被拼进 WSL 的 bash 命令（win32 路径），放开字符等于开一个注入面；
 * Docker 自己的命名规则本来也只允许这些字符。
 */
const CONTAINER_NAME_PATTERN = /^[a-z0-9][\w.-]{0,127}$/i

/** 命令的两种投递形态（平台判断的产物，单测直击 {@link resolvePgExecMode}） */
export type PgExecMode = 'wsl-bash' | 'docker-cli'

/** 本次进程内解析出的容器名（避免 preflight / dump / restore 三次各自 spawn 一次 docker ps） */
let cachedContainer: string | null = null

/**
 * 容器名解析（优先级从高到低）：
 * 1. `E2E_PG_CONTAINER`（显式指定，永不做任何猜测）；
 * 2. `CI=true` + 非 WSL 投递：按镜像 `postgres:18-alpine` 找 service 容器（CI 上容器名是随机的）；
 * 3. 默认 `e2e-wsl-postgres`（本机 WSL 栈）。
 */
export function resolvePgContainer(): string {
  if (cachedContainer !== null) {
    return cachedContainer
  }

  const explicit = process.env.E2E_PG_CONTAINER?.trim()
  if (explicit !== undefined && explicit !== '') {
    assertContainerName(explicit)
    cachedContainer = explicit
    return explicit
  }

  if (process.env.CI === 'true' && resolvePgExecMode(process.platform, process.env.E2E_PG_EXEC_MODE) === 'docker-cli') {
    const found = firstContainerByImage(CI_PG_IMAGE)
    if (found !== null) {
      assertContainerName(found)
      console.log(`[e2e/pg-container] CI 环境：按镜像 ${CI_PG_IMAGE} 解析到 service 容器 ${found}`)
      cachedContainer = found
      return found
    }
  }

  cachedContainer = DEFAULT_PG_CONTAINER
  return cachedContainer
}

/** 按镜像名找第一个容器（CI 专用；失败返回 null，让调用方走默认名并把错误留到 inspect 时报） */
function firstContainerByImage(image: string): string | null {
  const result = spawnSync('docker', ['ps', '-q', '--filter', `ancestor=${image}`], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: INSPECT_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    return null
  }
  const first = (result.stdout ?? '').split(/\r?\n/).map(line => line.trim()).find(line => line !== '')
  return first ?? null
}

/**
 * 平台 → 执行形态。`E2E_PG_EXEC_MODE` 可显式覆盖（`wsl` / `docker`；`auto` 或空 = 按平台）。
 *
 * 纯函数（platform / override 都是入参），用例直接喂 win32 / linux / darwin 断言。
 * 非法覆盖值按**环境问题**抛出（退出码 2）—— 静默回落成平台默认会让人以为参数生效了。
 */
export function resolvePgExecMode(platform: NodeJS.Platform, override?: string): PgExecMode {
  const value = (override ?? '').trim().toLowerCase()
  if (value === 'wsl' || value === 'wsl-bash') {
    return 'wsl-bash'
  }
  if (value === 'docker' || value === 'docker-cli') {
    return 'docker-cli'
  }
  if (value !== '' && value !== 'auto') {
    throw new E2ePreconditionError(
      `E2E_PG_EXEC_MODE=${override} 不认识（只接受 auto / wsl / docker）：`
      + 'wsl = 经 `wsl -e bash -c "docker exec …"`，docker = 直接调 docker CLI',
    )
  }
  return platform === 'win32' ? 'wsl-bash' : 'docker-cli'
}

/** 当前进程实际使用的执行形态（读 `process.platform` 与 `E2E_PG_EXEC_MODE`） */
function currentExecMode(): PgExecMode {
  return resolvePgExecMode(process.platform, process.env.E2E_PG_EXEC_MODE)
}

/** 容器名校验（拼进 bash 命令之前的唯一闸） */
export function assertContainerName(container: string): void {
  if (!CONTAINER_NAME_PATTERN.test(container)) {
    throw new E2ePreconditionError(
      `E2E_PG_CONTAINER=${JSON.stringify(container)} 不是合法的容器名（只允许字母 / 数字 / _ . -，且以字母数字开头）。`
      + ` 默认是 ${DEFAULT_PG_CONTAINER}；通用 compose 是 e2e-postgres。`,
    )
  }
}

/**
 * Windows 路径 → WSL 路径（`D:\a\b` → `/mnt/d/a/b`）。
 *
 * 只有落进 bash 命令里的路径需要换算（win32 的 dump 重定向）；argv 直传的路径不涉及。
 * 已经是 POSIX 形态时原样返回（正斜杠化）。
 */
export function toWslPath(windowsPath: string): string {
  const match = /^([a-z]):[\\/](.*)$/i.exec(windowsPath)
  if (match === null) {
    return windowsPath.replace(/\\/g, '/')
  }
  const drive = match[1] ?? ''
  const rest = (match[2] ?? '').replace(/\\/g, '/')
  return `/mnt/${drive.toLowerCase()}/${rest}`
}

/** stderr 只留尾部若干行 —— pg_restore 的噪音可能很长，报错要能一眼看到根因 */
function tailLines(text: string, limit = 20): string {
  return text.trim().split(/\r?\n/).slice(-limit).join('\n')
}

/** win32 的 WSL 投递（`wsl -e bash -c "…"`，天然无窗口） */
function runWslBash(script: string, options: { input?: Buffer } = {}): void {
  const result = spawnSync('wsl', ['-e', 'bash', '-c', script], {
    windowsHide: true,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: PG_EXEC_TIMEOUT_MS,
  })

  if (result.error !== undefined) {
    throw new E2ePreconditionError(
      `WSL 命令没跑起来：${result.error.message}\n`
      + `  本机的数据栈按 WSL 形态实现（容器 ${DEFAULT_PG_CONTAINER}，可用 E2E_PG_CONTAINER 覆盖；见 apps/e2e/README.md「WSL 常驻栈」）；`
      + 'Docker 跑在 Windows 侧（Docker Desktop）时用 E2E_PG_EXEC_MODE=docker，'
      + 'Docker 跑在原生 Linux 时直接运行（无需 WSL）；也可用 E2E_SKIP_BASELINE=1 退回全量 prepare。',
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `WSL 命令失败（exit ${result.status ?? 'signal'}）：${script}\n  ${tailLines(result.stderr.toString('utf8'))}`,
    )
  }
}

/** 原生 docker CLI 投递（argv 直传、不经 shell） */
function runDocker(args: readonly string[], options: { input?: Buffer } = {}): { stdout: Buffer } {
  const result = spawnSync('docker', args, {
    windowsHide: true,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: PG_EXEC_TIMEOUT_MS,
  })

  if (result.error !== undefined) {
    throw new E2ePreconditionError(
      `docker 命令没跑起来：${result.error.message}\n`
      + '  Docker 跑在 Windows（Docker Desktop）时确认 docker CLI 在 PATH 上；'
      + '跑在 WSL 里时用 E2E_PG_EXEC_MODE=wsl（默认按平台判断，win32 走 WSL）；'
      + '也可用 E2E_SKIP_BASELINE=1 退回全量 prepare。',
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `docker 命令失败（exit ${result.status ?? 'signal'}）：docker ${args.join(' ')}\n  ${tailLines(result.stderr.toString('utf8'))}`,
    )
  }
  return { stdout: result.stdout }
}

/**
 * 把库 dump 到本地文件（`pg_dump -Fc`，只在容器里执行）。
 *
 * - wsl-bash：在 WSL 里用 bash 重定向写文件，路径换算成 `/mnt/<盘符>/…`；
 * - docker-cli：Node 收 stdout 再写文件（不经过 shell，跨平台一致）。
 */
export function runPgDumpToFile(container: string, outputFile: string): void {
  assertContainerName(container)
  if (currentExecMode() === 'wsl-bash') {
    runWslBash(
      `docker exec ${container} pg_dump -U ${E2E_PG_USER} -Fc ${E2E_PG_DB} > '${toWslPath(outputFile)}'`,
    )
    return
  }
  const { stdout } = runDocker([
    'exec',
    container,
    'pg_dump',
    '-U',
    E2E_PG_USER,
    '-Fc',
    E2E_PG_DB,
  ])
  writeFileSync(outputFile, stdout)
}

/** 把 dump 文件喂给容器里的 `pg_restore`（`--clean --if-exists`；见 baseline 的调用说明） */
export function runPgRestoreFromFile(container: string, dump: Buffer): void {
  assertContainerName(container)
  const args = ['exec', '-i', container, 'pg_restore', '-U', E2E_PG_USER, '-d', E2E_PG_DB, '--clean', '--if-exists']
  if (currentExecMode() === 'wsl-bash') {
    runWslBash(`docker ${args.join(' ')}`, { input: dump })
    return
  }
  runDocker(args, { input: dump })
}

export interface PgContainerInspection {
  ok: boolean
  detail: string
}

/**
 * `docker inspect` 可读性检查（preflight 用）：容器存在且 **running** 才通过。
 *
 * 失败时不抛 —— preflight 要把所有检查汇总成一份「处置清单」一次打印。
 */
export function inspectPgContainer(container = resolvePgContainer()): PgContainerInspection {
  assertContainerName(container)
  const mode = currentExecMode()
  const result = mode === 'wsl-bash'
    ? spawnSync('wsl', ['-e', 'bash', '-c', `docker inspect --format '{{.State.Status}}' ${container}`], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: INSPECT_TIMEOUT_MS,
      })
    : spawnSync('docker', ['inspect', '--format', '{{.State.Status}}', container], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: INSPECT_TIMEOUT_MS,
      })

  if (result.error !== undefined) {
    return { ok: false, detail: `无法执行 docker inspect：${result.error.message}` }
  }
  if (result.status !== 0) {
    return {
      ok: false,
      detail: `docker inspect 失败（exit ${result.status ?? 'signal'}）：${tailLines(result.stderr, 5) || '（无 stderr）'}`,
    }
  }

  const status = (result.stdout ?? '').trim()
  if (status !== 'running') {
    return { ok: false, detail: `容器 ${container} 存在但状态是 ${status === '' ? '未知' : status}（期望 running）` }
  }
  return { ok: true, detail: `容器 ${container} running` }
}
