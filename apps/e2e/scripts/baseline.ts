/**
 * 测试库封板（baseline）：**seal 一次、restore 每轮**。
 *
 * 背景：每轮 `prepare-db` 都 drop → 迁移 → seed，数据永远来自仓库当前真源 —— 慢，而且
 * 「这一轮用的测试数据是什么版本」没有显式记录。封板把「一套完整准备好的库」固化成基线：
 *
 * - **seal（封板）**：全量 prepare 成功后，用容器里的 `pg_dump -Fc` 把 `walnut_e2e` 导成
 *   `.e2e/baseline.dump`，并写封板清单 `.e2e/baseline.manifest.json`（HEAD / 迁移头 / sha256 /
 *   菜单行数…）。快照的内容 = **迁移 + seed + admin 提升为 root + CAP 节流放宽完成后的状态**；
 * - **restore（恢复）**：每轮默认动作 —— `DROP/CREATE DATABASE` 后 `pg_restore` 回来，再做
 *   **不在这份快照里**的运行时重置（`walnut_app` 口令、Redis 设置缓存、`.auth/credentials.json`，
 *   见 scripts/runtime-reset.ts 的文件头）。
 *
 * 漂移判据：清单里的 `gitCommit` ≠ 当前 HEAD ⇒ **退出码 2**，提示重新封板。它覆盖的是主场景
 * 「改了迁移 / seed 却没重新封板」；成本只有一次 `git rev-parse`。**未提交**的迁移/seed 改动
 * 不会改变 HEAD，那种情况要自己加 `--rebuild-baseline`。
 *
 * 逃生口：`E2E_SKIP_BASELINE=1` 忽略基线、退回全量 prepare（排查基线本身的问题用）。
 * 强制重开：`--rebuild-baseline`（或 `E2E_REBUILD_BASELINE=1`）→ 全量 prepare + seal。
 *
 * 命令形态：本机数据栈在 WSL 的 Docker 里（容器 `e2e-wsl-postgres`），dump/restore 都经
 * `wsl -e bash -c "docker exec …"` 执行 —— **天然无窗口**；Windows 侧没有任何可见进程。
 * dump 文件的路径按 `/mnt/<盘符>/…` 换算（{@link toWslPath}）。
 *
 * 安全闸：所有 dump/restore 只作用于 `walnut_e2e`（{@link assertE2eDatabase} 一族），
 * 与 prepare-db / lib/pg.ts 同一口径 —— 库名或端口不对就在动库之前抛错。
 */
import type { Buffer } from 'node:buffer'
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import {
  ARTIFACT_DIR,
  assertE2eDatabase,
  assertE2ePgPort,
  AUTH_DIR,
  BASELINE_CREDENTIALS_FILE,
  BASELINE_DUMP_FILE,
  BASELINE_MANIFEST_FILE,
  CREDENTIALS_FILE,
  E2E_PG_APP_USER,
  E2E_PG_DB,
  E2E_PG_HOST,
  E2E_PG_PASS,
  E2E_PG_PORT,
  E2E_PG_USER,
  REPO_ROOT,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'
import { prepareDatabase } from './prepare-db.ts'
import { clearAppSettingCache, resetRuntimeRolePassword } from './runtime-reset.ts'

/**
 * 基线三个文件的路径定义在 `scripts/env.ts`（`BASELINE_DUMP_FILE` / `BASELINE_MANIFEST_FILE` /
 * `BASELINE_CREDENTIALS_FILE`）：测试进程（失败现场 attach）也要读封板清单，不该为一条路径
 * 把本文件的 pg / redis / prepare-db 依赖链拖进每个 worker。
 */
export {
  BASELINE_CREDENTIALS_FILE,
  BASELINE_DUMP_FILE,
  BASELINE_MANIFEST_FILE,
} from './env.ts'

/** 数据栈容器名（见 apps/e2e/README.md 的「WSL 常驻栈」）：dump/restore 在容器里执行 */
const PG_CONTAINER = 'e2e-wsl-postgres'
/** 清单格式版本：形态变化时 +1 —— 旧清单会被读成「不可用」，而不是被按新形态误读 */
const MANIFEST_VERSION = 1
/** WSL 命令的兜底超时（正常是秒级；卡住时别让整轮无限等） */
const WSL_TIMEOUT_MS = 120_000

/**
 * 封板清单 —— 「这份快照是什么」的全部可核对信息。
 *
 * 它的作用不只是记账：restore 用 `dumpBytes` / `dumpSha256` 判断文件有没有被替换或半写，
 * 用 `migrationsHead` / `menuRows` 在恢复后做 sanity 断言（dump 和清单必须是一对）。
 */
export interface BaselineManifest {
  /** 清单格式版本（{@link MANIFEST_VERSION}） */
  manifestVersion: number
  /** 封板时刻（ISO 8601） */
  sealedAt: string
  /**
   * 封板时的仓库 HEAD（40 位）。restore 前与当前 HEAD 比对：
   * 不一致说明「迁移 / seed 相对封板时已变化」，拒绝执行并要求重新封板。
   */
  gitCommit: string
  /** 库内 `migrations` 表的最大 id 与迁移名（快照的迁移头） */
  migrationsHead: { id: number, name: string }
  /** dump 的 sha256（hex）与字节数 —— 防手工替换 / 半写文件 */
  dumpSha256: string
  dumpBytes: number
  /** 封板时 `sys_menu` 的行数；restore 后断言 ≥ 它（root 的菜单树靠它不留空壳） */
  menuRows: number
}

/** 基线可用性判定（{@link baselineUsable}）—— 每一条都对应一种处置方式 */
export type BaselineUsage
  = | { kind: 'usable', manifest: BaselineManifest }
  /** 没有清单 / 清单损坏：按「首次运行」处理，全量 prepare 后重新封板 */
    | { kind: 'missing' }
  /** 清单或 dump 对不上（文件缺失 / 大小或 sha 不符）：当环境问题拒绝执行，提示重新封板 */
    | { kind: 'invalid', reason: string }
  /** 仓库 HEAD 变了：迁移 / seed 可能已改，拒绝执行并提示重新封板（退出码 2） */
    | { kind: 'drifted', manifest: BaselineManifest, head: string }

/** 本轮库准备的方式（{@link ensureTestDatabase} 的返回值，日志里也会体现） */
export type DatabaseMode = 'restore' | 'prepare' | 'prepare+seal'

export interface EnsureTestDatabaseOptions {
  /** run.ts 整轮持有的维护连接（advisory lock 在它上面；restore 的 DROP/CREATE 复用它） */
  maintenance: Client
  /** 强制全量 prepare + seal（`--rebuild-baseline` / `E2E_REBUILD_BASELINE=1`） */
  rebuild?: boolean
  /** 忽略基线、退回全量 prepare 且不封板（`E2E_SKIP_BASELINE=1`，排查基线本身用） */
  skipBaseline?: boolean
}

interface BaselineCredentials {
  userName: string
  password: string
}

function log(message: string): void {
  console.log(`[e2e/baseline] ${message}`)
}

function warn(message: string): void {
  console.warn(`[e2e/baseline] ${message}`)
}

function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** 当前仓库 HEAD（完整 40 位）。读不到就是环境问题（退出码 2）：漂移判定依赖它 */
function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
  }
  catch (error) {
    throw new E2ePreconditionError(
      `读不到 git HEAD（封板漂移检查依赖它）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Windows 路径 → WSL 路径（`D:\a\b` → `/mnt/d/a/b`）。
 *
 * 只有落进 bash 命令里的那几个路径需要换算；`spawnSync` 的 `input` 是二进制流，不涉及路径。
 * 已经是 POSIX 形态（原生 Linux）时原样返回。
 */
function toWslPath(windowsPath: string): string {
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

/**
 * 跑一段 bash（在 WSL 里）。
 *
 * `wsl -e bash -c "…"` 是**无窗口**的：本机禁止弹可见终端，这条路径没有窗口可弹。
 * `windowsHide: true` 是 Windows 侧子进程统一的兜底。
 */
function runWslBash(script: string, options: { input?: Buffer } = {}): void {
  const result = spawnSync('wsl', ['-e', 'bash', '-c', script], {
    windowsHide: true,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: WSL_TIMEOUT_MS,
  })

  if (result.error !== undefined) {
    throw new E2ePreconditionError(
      `WSL 命令没跑起来：${result.error.message}\n`
      + `  本机的数据栈按 WSL 形态实现（容器 ${PG_CONTAINER}，见 apps/e2e/README.md「WSL 常驻栈」）；`
      + 'Docker 跑在 Windows / 原生 Linux 的机器可用 E2E_SKIP_BASELINE=1 退回全量 prepare。',
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `WSL 命令失败（exit ${result.status ?? 'signal'}）：${script}\n  ${tailLines(result.stderr.toString('utf8'))}`,
    )
  }
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 清单形态校验：缺字段 / 形态不对都算「不可用」，绝不「尽量读」 */
function isManifest(value: unknown): value is BaselineManifest {
  if (!isRecord(value)) {
    return false
  }
  const head = value.migrationsHead
  return value.manifestVersion === MANIFEST_VERSION
    && typeof value.sealedAt === 'string' && value.sealedAt !== ''
    && typeof value.gitCommit === 'string' && /^[0-9a-f]{40}$/.test(value.gitCommit)
    && isRecord(head)
    && typeof head.id === 'number' && Number.isInteger(head.id) && head.id > 0
    && typeof head.name === 'string' && head.name !== ''
    && typeof value.dumpSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.dumpSha256)
    && typeof value.dumpBytes === 'number' && Number.isInteger(value.dumpBytes) && value.dumpBytes > 0
    && typeof value.menuRows === 'number' && Number.isInteger(value.menuRows) && value.menuRows >= 0
}

/**
 * 读封板清单。文件不存在 ⇒ null；存在但读不了 / 形态不对 ⇒ 打 warning 后 null
 * （调用方按「首次运行」处理：全量 prepare + 重新封板，能自愈，但日志里会留下线索）。
 */
export function readManifest(): BaselineManifest | null {
  if (!existsSync(BASELINE_MANIFEST_FILE)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(BASELINE_MANIFEST_FILE, 'utf8'))
    if (!isManifest(parsed)) {
      warn(`封板清单形态不对（${BASELINE_MANIFEST_FILE}）—— 按「没有基线」处理，本轮全量 prepare 后重新封板`)
      return null
    }
    return parsed
  }
  catch (error) {
    warn(`读不了封板清单（${BASELINE_MANIFEST_FILE}）：${error instanceof Error ? error.message : String(error)} —— 按「没有基线」处理`)
    return null
  }
}

/**
 * 基线是否可用于本轮 restore。
 *
 * 判定顺序（先便宜后昂贵）：清单存在 → dump 存在 → **HEAD 一致** → 大小 → sha256。
 * HEAD 放在最前是有意的：漂移是最常见的失败，也是最该给出「重新封板」提示的那一类。
 */
export function baselineUsable(): BaselineUsage {
  const manifest = readManifest()
  if (manifest === null) {
    return { kind: 'missing' }
  }
  if (!existsSync(BASELINE_DUMP_FILE)) {
    return { kind: 'invalid', reason: `清单在，但基线文件 ${BASELINE_DUMP_FILE} 不在` }
  }
  const head = gitHead()
  if (manifest.gitCommit !== head) {
    return { kind: 'drifted', manifest, head }
  }
  const dumpBytes = statSync(BASELINE_DUMP_FILE).size
  if (dumpBytes !== manifest.dumpBytes) {
    return { kind: 'invalid', reason: `基线文件大小 ${dumpBytes} B 与清单记录的 ${manifest.dumpBytes} B 不符` }
  }
  const dumpSha256 = sha256File(BASELINE_DUMP_FILE)
  if (dumpSha256 !== manifest.dumpSha256) {
    return { kind: 'invalid', reason: '基线文件的 sha256 与清单记录不符（被替换 / 半写）' }
  }
  return { kind: 'usable', manifest }
}

function readBaselineCredentials(): BaselineCredentials {
  if (!existsSync(BASELINE_CREDENTIALS_FILE)) {
    throw new E2ePreconditionError(
      `缺 ${BASELINE_CREDENTIALS_FILE} —— 没有它就无法用快照里那份口令身份登录；`
      + '用 `node scripts/run.ts --rebuild-baseline` 重新封板（会一并写回口令文件）',
    )
  }
  const parsed = JSON.parse(readFileSync(BASELINE_CREDENTIALS_FILE, 'utf8')) as Partial<BaselineCredentials>
  if (typeof parsed.userName !== 'string' || typeof parsed.password !== 'string' || parsed.password === '') {
    throw new E2ePreconditionError(
      `${BASELINE_CREDENTIALS_FILE} 里没有 userName/password —— 用 --rebuild-baseline 重新封板`,
    )
  }
  return { userName: parsed.userName, password: parsed.password }
}

async function connectDatabase(): Promise<Client> {
  const client = new Client({
    host: E2E_PG_HOST,
    port: E2E_PG_PORT,
    user: E2E_PG_USER,
    password: E2E_PG_PASS,
    database: E2E_PG_DB,
    connectionTimeoutMillis: 5_000,
  })
  await client.connect()
  return client
}

/** 运行态断言（同 lib/pg.ts 的口径）：连上之后确认**真的**落在 walnut_e2e 上 */
async function assertCurrentDatabase(client: Client): Promise<void> {
  const { rows } = await client.query<{ database: string }>('SELECT current_database() AS database')
  const actual = rows[0]?.database
  if (actual !== E2E_PG_DB) {
    throw new Error(`[e2e/safety] 连接落在库 \`${actual}\` 上（期望 \`${E2E_PG_DB}\`）—— 拒绝继续`)
  }
}

/** 封板前读一遍库内事实（迁移头 / 菜单行数）；顺带确认迁移真的跑过 */
async function readSealFacts(): Promise<{ migrationsHead: BaselineManifest['migrationsHead'], menuRows: number }> {
  const db = await connectDatabase()
  try {
    await assertCurrentDatabase(db)
    const head = await db.query<{ id: number, name: string }>('SELECT id, name FROM migrations ORDER BY id DESC LIMIT 1')
    const row = head.rows[0]
    if (row === undefined) {
      throw new Error('库里没有 migrations 行 —— 封板前必须先跑完迁移（全量 prepare）')
    }
    const menus = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM sys_menu')
    const menuRows = menus.rows[0]?.count ?? 0
    if (menuRows === 0) {
      throw new Error('sys_menu 是空的 —— seed 没播成功，拒绝封板')
    }
    return { migrationsHead: { id: row.id, name: row.name }, menuRows }
  }
  finally {
    await db.end()
  }
}

function writeRestoredCredentials(credentials: BaselineCredentials): void {
  mkdirSync(AUTH_DIR, { recursive: true })
  writeFileSync(
    CREDENTIALS_FILE,
    `${JSON.stringify({ userName: credentials.userName, password: credentials.password, totpSecret: '' }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

/**
 * restore 之后的库内断言 + 运行时重置（同一个连接里做完）。
 *
 * sanity 断言（外加 dump 与清单配对）：
 * - `SELECT current_database()` = walnut_e2e（运行态安全闸）；
 * - admin 账号存在；
 * - `sys_menu` 行数 ≥ 清单记录值（root 的菜单树靠 junction 算，菜单缺了会留下空壳侧边栏）；
 * - `migrations` 头 = 清单记录值（证明 dump 和清单确实是一对，没有被别处的 dump 顶替）。
 */
async function finalizeRestoredDatabase(manifest: BaselineManifest): Promise<{ menuRows: number }> {
  const db = await connectDatabase()
  try {
    await assertCurrentDatabase(db)

    const admin = await db.query('SELECT 1 FROM sys_user WHERE user_name = $1', ['admin'])
    if ((admin.rowCount ?? 0) === 0) {
      throw new Error('恢复后的库里没有 admin 账号 —— 基线内容不完整，用 --rebuild-baseline 重新封板')
    }

    const menus = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM sys_menu')
    const menuRows = menus.rows[0]?.count ?? 0
    if (menuRows < manifest.menuRows) {
      throw new Error(
        `恢复后的菜单行数 ${menuRows} < 清单记录的 ${manifest.menuRows} —— 基线内容不完整，用 --rebuild-baseline 重新封板`,
      )
    }

    const head = await db.query<{ id: number, name: string }>('SELECT id, name FROM migrations ORDER BY id DESC LIMIT 1')
    const row = head.rows[0]
    if (row === undefined || row.id !== manifest.migrationsHead.id || row.name !== manifest.migrationsHead.name) {
      throw new Error(
        `恢复后的迁移头（${row?.id ?? '无'} / ${row?.name ?? '无'}）与清单记录（${manifest.migrationsHead.id} / ${manifest.migrationsHead.name}）不一致 `
        + '—— dump 与清单不是一对，用 --rebuild-baseline 重新封板',
      )
    }

    await resetRuntimeRolePassword(db)
    return { menuRows }
  }
  finally {
    await db.end()
  }
}

/**
 * 封板：把**已经准备好**的库导出成基线 + 清单。
 *
 * 调用前提：`prepareDatabase()` 刚跑完（迁移、seed、admin 提升为 root、CAP 放宽都已完成）。
 * 顺序：读库内事实 → `pg_dump -Fc` 到临时文件 → 校验非空 / 算 sha256 → 原子改名 → 写清单。
 * 中途失败时**上一份可用基线保持原样**（临时文件删掉），不会被半写文件顶掉。
 */
export async function sealBaseline(): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  const started = Date.now()
  const facts = await readSealFacts()

  // 先把口令读出来：它缺失时要在**动基线文件之前**失败，否则会出现「新 dump + 旧清单」的半截状态
  if (!existsSync(CREDENTIALS_FILE)) {
    throw new Error(`封板前必须有 ${CREDENTIALS_FILE}（prepareDatabase 会写）—— 找不到说明 prepare 没跑完`)
  }
  const credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as Partial<BaselineCredentials>
  if (typeof credentials.userName !== 'string' || typeof credentials.password !== 'string' || credentials.password === '') {
    throw new Error(`${CREDENTIALS_FILE} 里没有 userName/password —— 拒绝封板（快照里的口令身份需要它）`)
  }

  const tmpDump = `${BASELINE_DUMP_FILE}.tmp`
  rmSync(tmpDump, { force: true })
  const dumpStarted = Date.now()
  try {
    runWslBash(`docker exec ${PG_CONTAINER} pg_dump -U ${E2E_PG_USER} -Fc ${E2E_PG_DB} > '${toWslPath(tmpDump)}'`)
  }
  catch (error) {
    rmSync(tmpDump, { force: true })
    throw new Error(`pg_dump 失败，基线未更新：${error instanceof Error ? error.message : String(error)}`)
  }
  const dumpMs = Date.now() - dumpStarted

  const dumpBytes = statSync(tmpDump).size
  if (dumpBytes === 0) {
    rmSync(tmpDump, { force: true })
    throw new Error('pg_dump 产出了空文件 —— 拒绝写清单（旧基线保持原样）')
  }
  const dumpSha256 = sha256File(tmpDump)
  renameSync(tmpDump, BASELINE_DUMP_FILE)

  writeFileSync(
    BASELINE_CREDENTIALS_FILE,
    `${JSON.stringify({ userName: credentials.userName, password: credentials.password }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )

  const manifest: BaselineManifest = {
    manifestVersion: MANIFEST_VERSION,
    sealedAt: new Date().toISOString(),
    gitCommit: gitHead(),
    migrationsHead: facts.migrationsHead,
    dumpSha256,
    dumpBytes,
    menuRows: facts.menuRows,
  }
  writeFileSync(BASELINE_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  log(`seal 完成：${path.basename(BASELINE_DUMP_FILE)} ${dumpBytes} B（pg_dump ${formatSeconds(dumpMs)}，总 ${formatSeconds(Date.now() - started)}）`)
  log(`清单：HEAD ${shortSha(manifest.gitCommit)}、迁移头 ${facts.migrationsHead.id}（${facts.migrationsHead.name}）、菜单 ${facts.menuRows} 行、sha256 ${dumpSha256.slice(0, 12)}…`)
  log(`基线文件与清单都在 gitignored 的 .e2e/（不入库）：${BASELINE_DUMP_FILE}`)
}

/**
 * restore：从基线恢复 `walnut_e2e`，然后补上**不在快照里**的运行时状态。
 *
 * 这里的 `--clean --if-exists` 在「刚 DROP/CREATE 过的空库」上是一段无害的 no-op；保留它是因为
 * 恢复流程不应假设调用方一定清过库 —— 若将来有人在非空库上恢复，它至少不会撞「对象已存在」。
 */
export async function restoreBaseline(options: { maintenance: Client }): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  const manifest = readManifest()
  if (manifest === null) {
    throw new E2ePreconditionError(
      `没有可用的封板清单（${BASELINE_MANIFEST_FILE}）—— 用 \`node scripts/run.ts --rebuild-baseline\` 重新封板`,
    )
  }
  const credentials = readBaselineCredentials()

  const started = Date.now()
  log(`DROP DATABASE IF EXISTS ${E2E_PG_DB} WITH (FORCE) → CREATE DATABASE（先清空目标库）`)
  await options.maintenance.query(`DROP DATABASE IF EXISTS "${E2E_PG_DB}" WITH (FORCE)`)
  await options.maintenance.query(`CREATE DATABASE "${E2E_PG_DB}"`)

  log(`pg_restore（容器 ${PG_CONTAINER}，${path.basename(BASELINE_DUMP_FILE)} ${manifest.dumpBytes} B）`)
  try {
    runWslBash(
      `docker exec -i ${PG_CONTAINER} pg_restore -U ${E2E_PG_USER} -d ${E2E_PG_DB} --clean --if-exists`,
      { input: readFileSync(BASELINE_DUMP_FILE) },
    )
  }
  catch (error) {
    throw new Error(
      `从基线恢复失败：${error instanceof Error ? error.message : String(error)}\n`
      + '  基线只对「同一套 WSL 数据栈 + 同一份封板清单」有效；换过数据卷 / 清过库时旧基线不再适用 '
      + '—— 用 `node scripts/run.ts --rebuild-baseline` 重新封板',
    )
  }

  const facts = await finalizeRestoredDatabase(manifest)
  writeRestoredCredentials(credentials)
  await clearAppSettingCache()

  log(
    `restore 完成（${formatSeconds(Date.now() - started)}）：迁移头 ${manifest.migrationsHead.id}、菜单 ${facts.menuRows} 行、admin 存在；`
    + `已重置 ${E2E_PG_APP_USER} 口令、清 Redis 设置缓存、写 ${CREDENTIALS_FILE}（口令取封板时那一份）`,
  )
}

/**
 * 本轮库准备的**决策点**（run.ts 的第三步，整轮在 advisory lock 内）：
 *
 * | 条件 | 动作 |
 * |------|------|
 * | `E2E_SKIP_BASELINE=1` | 全量 prepare（不封板；排查基线本身用） |
 * | `--rebuild-baseline` / `E2E_REBUILD_BASELINE=1` | 全量 prepare + seal |
 * | 没有基线（首次 / 清过目录） | 全量 prepare + seal（自举） |
 * | 有基线但 HEAD 相对封板时变化 | **抛前置错误（退出码 2）**，提示重新封板 |
 * | 基线文件 / 清单对不上 | **抛前置错误（退出码 2）**，提示重新封板 |
 * | 基线有效且 HEAD 一致 | restore（不跑迁移 / seed） |
 */
export async function ensureTestDatabase(options: EnsureTestDatabaseOptions): Promise<DatabaseMode> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  if (options.skipBaseline === true && options.rebuild === true) {
    throw new E2ePreconditionError(
      'E2E_SKIP_BASELINE=1 与 --rebuild-baseline / E2E_REBUILD_BASELINE=1 互斥：'
      + '前者「忽略基线」，后者「重新封板」，同时给无法判断你想要哪个。去掉一个再跑。',
    )
  }

  if (options.skipBaseline === true) {
    log('E2E_SKIP_BASELINE=1：忽略基线，退回全量 prepare（本轮不封板）')
    await prepareDatabase({ lockHeld: true })
    return 'prepare'
  }

  if (options.rebuild === true) {
    log('--rebuild-baseline：强制全量 prepare，然后重新封板')
    await prepareDatabase({ lockHeld: true })
    await sealBaseline()
    return 'prepare+seal'
  }

  const usage = baselineUsable()

  if (usage.kind === 'usable') {
    log(
      `基线有效（封板于 ${usage.manifest.sealedAt}，HEAD ${shortSha(usage.manifest.gitCommit)}，`
      + `迁移头 ${usage.manifest.migrationsHead.id}，菜单 ${usage.manifest.menuRows} 行）→ 从基线恢复（不跑迁移 / seed）`,
    )
    await restoreBaseline({ maintenance: options.maintenance })
    return 'restore'
  }

  if (usage.kind === 'missing') {
    log('没有基线（首次运行 / 清过目录）→ 全量 prepare 后自动封板')
    await prepareDatabase({ lockHeld: true })
    await sealBaseline()
    return 'prepare+seal'
  }

  if (usage.kind === 'invalid') {
    throw new E2ePreconditionError(
      `基线不可用：${usage.reason}。\n`
      + '  运行 `node scripts/run.ts --rebuild-baseline` 重新封板（或 `E2E_SKIP_BASELINE=1` 跳过基线、退回全量 prepare）',
    )
  }

  throw new E2ePreconditionError(
    `迁移/seed 相对封板时已变化（封板 commit ${shortSha(usage.manifest.gitCommit)}，当前 HEAD ${shortSha(usage.head)}）。\n`
    + '  运行 `node scripts/run.ts --rebuild-baseline` 重新封板（或 `E2E_SKIP_BASELINE=1` 跳过基线、退回全量 prepare）',
  )
}
