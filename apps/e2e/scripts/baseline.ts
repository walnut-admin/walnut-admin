/**
 * 测试库封板（baseline）：**seal 一次、restore 每轮**。
 *
 * 背景：每轮 `prepare-db` 都 drop → 迁移 → seed，数据永远来自仓库当前真源 —— 慢，而且
 * 「这一轮用的测试数据是什么版本」没有显式记录。封板把「一套完整准备好的库」固化成基线：
 *
 * - **seal（封板）**：全量 prepare 成功后，用数据栈容器里的 `pg_dump -Fc` 把 `walnut_e2e` 导成
 *   `.e2e/baseline.dump`，并写**封板 meta / 清单** `.e2e/baseline.manifest.json`（版本 2：HEAD、
 *   数据树哈希 dataKey、迁移头、dump / credentials 的 sha256 与字节数、菜单行数…）。快照的内容
 *   = **迁移 + seed + admin 提升为 root + CAP 节流放宽完成后的状态**；
 * - **restore（恢复）**：每轮默认动作 —— `DROP/CREATE DATABASE` 后 `pg_restore` 回来，再做
 *   **不在这份快照里**的运行时重置（`walnut_app` 口令、Redis 设置缓存、`.auth/credentials.json`，
 *   见 scripts/runtime-reset.ts 的文件头）。
 *
 * 漂移判据（P1-1）：
 * - **dataKey**（`scripts/data-key.ts`）：HEAD 上「数据路径」的组合树哈希。与封板时不同 ⇒ 退出码 2；
 * - **工作区脏**：数据路径有未提交改动（`git status --porcelain`）⇒ 同样退出码 2 ——
 *   两种都提示 `--rebuild-baseline`。只改文档 / 前端 / 后端源码**不**触发漂移；
 * - 清单 `dataDirty=true`（封板时就不干净）⇒ 永远判不可用（那份数据无法证明与仓库一致）。
 *
 * 原子封板：dump / credentials / 清单三者先各写临时文件，最后**先撤旧清单、再逐个 rename**。
 * 任何时刻都不会出现「新 dump + 旧清单」；中途失败（含 kill）留下的状态是「没有清单」，
 * 下一次运行会按「封板中断的半成品」拒绝使用并提示重封板。
 *
 * 逃生口：`E2E_SKIP_BASELINE=1` 忽略基线、退回全量 prepare（排查基线本身的问题用）。
 * 强制重开：`--rebuild-baseline`（或 `E2E_REBUILD_BASELINE=1`）→ 全量 prepare + seal。
 *
 * 容器与平台（P1-1）：容器名默认 `e2e-wsl-postgres`，用 `E2E_PG_CONTAINER` 覆盖；win32 经
 * `wsl -e bash -c "docker exec …"`（天然无窗口），其它平台直接 `docker exec`（见 scripts/pg-container.ts）。
 *
 * 安全闸：所有 dump/restore 只作用于**当前 profile 的库**（{@link assertE2eDatabase} 一族），
 * 与 prepare-db / lib/pg.ts 同一口径 —— 库名或端口不对就在动库之前抛错。清单里还有
 * `profile` / `database` 两个字段（v3）：restore 前断言它们与当前 profile 一致，所以把 smoke 的
 * dump 拷进 risk 目录也恢复不了（先 sha 校验、再库名字段）。
 */
import type { BaselineManifest } from './baseline-manifest.ts'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { isBaselineManifest, MANIFEST_VERSION, manifestVersionOf } from './baseline-manifest.ts'
import { currentDataSnapshot } from './data-key.ts'
import { DATA_PATHS } from './e2e-data-paths.ts'
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
import { resolvePgContainer, runPgDumpToFile, runPgRestoreFromFile } from './pg-container.ts'
import { prepareDatabase } from './prepare-db.ts'
import { clearAppSettingCache, resetRuntimeRolePassword } from './runtime-reset.ts'
import { STACK_PROFILE } from './stack-profiles.ts'

export { MANIFEST_VERSION } from './baseline-manifest.ts'
/**
 * 基线三个文件的路径定义在 `scripts/env.ts`（`BASELINE_DUMP_FILE` / `BASELINE_MANIFEST_FILE` /
 * `BASELINE_CREDENTIALS_FILE`）：测试进程（失败现场 attach）也要读封板清单，不该为一条路径
 * 把本文件的 pg / redis / prepare-db 依赖链拖进每个 worker。
 */
export { BASELINE_CREDENTIALS_FILE, BASELINE_DUMP_FILE, BASELINE_MANIFEST_FILE } from './env.ts'

/** 基线可用性判定（{@link baselineUsable}）—— 每一条都对应一种处置方式 */
export type BaselineUsage =
  | { kind: 'usable'; manifest: BaselineManifest }
  /** 没有清单也没有残留文件：按「首次运行」处理，全量 prepare 后重新封板 */
  | { kind: 'missing' }
  /** 清单 / 文件 / 形态对不上（含旧版本、半成品）：当环境问题拒绝执行，提示重新封板 */
  | { kind: 'invalid'; reason: string }
  /**
   * 数据源相对封板时变了：dataKey 不一致，或数据路径有未提交改动。
   * 两种都拒绝执行并提示重新封板（退出码 2）。
   */
  | { kind: 'drifted'; manifest: BaselineManifest; dataKey: string; dirtyPaths: string[] }

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

/** 清单的读取结果（三种「不可用」分开报：缺失 / 旧格式 / 损坏，处置措辞不同） */
type ManifestState =
  | { kind: 'ok'; manifest: BaselineManifest }
  | { kind: 'missing' }
  | { kind: 'unusable'; reason: string }

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

/** 当前仓库 HEAD（完整 40 位）—— 只用于 `gitCommit` 展示与封板日志 */
function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
  } catch (error) {
    throw new E2ePreconditionError(
      `读不到 git HEAD（封板清单的展示字段依赖它）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 没有清单时可能残留的两个文件：有它们说明上一次封板走到了中途（半成品） */
function residualBaselineFiles(): string[] {
  return [BASELINE_DUMP_FILE, BASELINE_CREDENTIALS_FILE].filter((file) => existsSync(file))
}

/**
 * 读封板清单并分类。
 *
 * - 文件不存在且没有残留 ⇒ `missing`（首次运行 / 清过目录，自举：全量 prepare + seal）；
 * - 文件不存在但有 dump / credentials 残留 ⇒ `unusable`（**封板中断的半成品**）——
 *   不能按「首次运行」静默重建，否则「新 dump 配旧口令」这类组合会被下一轮吞掉；
 * - 版本不是 {@link MANIFEST_VERSION} ⇒ `unusable`（旧格式，不迁移，提示重封板）；
 * - 形态不对 / 读不了 ⇒ `unusable`。
 */
function readManifestState(): ManifestState {
  if (!existsSync(BASELINE_MANIFEST_FILE)) {
    const residuals = residualBaselineFiles()
    if (residuals.length > 0) {
      return {
        kind: 'unusable',
        reason:
          `封板清单缺失，但残留 ${residuals.map((file) => path.basename(file)).join(' / ')}` +
          '（上一次封板在写清单之前中断，这是半成品）',
      }
    }
    return { kind: 'missing' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(BASELINE_MANIFEST_FILE, 'utf8'))
  } catch (error) {
    return {
      kind: 'unusable',
      reason: `读不了封板清单 ${BASELINE_MANIFEST_FILE}：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const version = manifestVersionOf(parsed)
  if (version !== MANIFEST_VERSION) {
    return {
      kind: 'unusable',
      reason:
        version === null
          ? `封板清单没有可识别的 manifestVersion（文件损坏？）：${BASELINE_MANIFEST_FILE}`
          : `封板清单是旧格式（manifestVersion=${version}，当前 ${MANIFEST_VERSION}）。` +
            '旧版本不做迁移（v1 缺 dataKey / credentials 的 sha；v2 缺 profile / database，无法证明跨 profile 配对）',
    }
  }
  if (!isBaselineManifest(parsed)) {
    return {
      kind: 'unusable',
      reason: `封板清单字段缺失或形态不对：${BASELINE_MANIFEST_FILE}`,
    }
  }
  return { kind: 'ok', manifest: parsed }
}

/**
 * 读封板清单（不可用时打 warning 后 null）。
 *
 * 只给「想拿清单做展示」的调用方；restore 走 {@link readManifestState}，因为「不可用」的
 * 具体原因（旧格式 / 半成品 / 损坏）值得原样告诉用户。
 */
export function readManifest(): BaselineManifest | null {
  const state = readManifestState()
  if (state.kind === 'ok') {
    return state.manifest
  }
  if (state.kind === 'unusable') {
    warn(`${state.reason} —— 按「没有可用基线」处理`)
  }
  return null
}

/** 基线文件与清单记录配对校验（sha / 字节数）；不通过按前置条件抛出（退出码 2） */
function assertBaselineFilesMatch(manifest: BaselineManifest): void {
  if (!existsSync(BASELINE_DUMP_FILE)) {
    throw new E2ePreconditionError(
      `清单在，但基线文件 ${BASELINE_DUMP_FILE} 不在 —— 用 --rebuild-baseline 重新封板`,
    )
  }
  const dumpBytes = statSync(BASELINE_DUMP_FILE).size
  if (dumpBytes !== manifest.dumpBytes) {
    throw new E2ePreconditionError(
      `基线文件大小 ${dumpBytes} B 与清单记录的 ${manifest.dumpBytes} B 不符（被替换 / 半写）—— 用 --rebuild-baseline 重新封板`,
    )
  }
  if (sha256File(BASELINE_DUMP_FILE) !== manifest.dumpSha256) {
    throw new E2ePreconditionError(
      '基线文件的 sha256 与清单记录不符（被替换 / 半写）—— 用 --rebuild-baseline 重新封板',
    )
  }

  if (!existsSync(BASELINE_CREDENTIALS_FILE)) {
    throw new E2ePreconditionError(
      `清单在，但封板口令文件 ${BASELINE_CREDENTIALS_FILE} 不在 —— 没有它无法用快照里的口令身份登录；用 --rebuild-baseline 重新封板`,
    )
  }
  const credentialsBytes = statSync(BASELINE_CREDENTIALS_FILE).size
  if (credentialsBytes !== manifest.credentialsBytes) {
    throw new E2ePreconditionError(
      `封板口令文件大小 ${credentialsBytes} B 与清单记录的 ${manifest.credentialsBytes} B 不符 —— 用 --rebuild-baseline 重新封板`,
    )
  }
  if (sha256File(BASELINE_CREDENTIALS_FILE) !== manifest.credentialsSha256) {
    throw new E2ePreconditionError(
      '封板口令文件的 sha256 与清单记录不符 —— 用 --rebuild-baseline 重新封板',
    )
  }
}

/**
 * 基线是否可用于本轮 restore。
 *
 * 判定顺序（先便宜后昂贵）：清单形态 → 封板时是否脏 → dump / credentials 存在 → **dataKey 与
 * 工作区脏状态** → dump / credentials 的字节数与 sha256。
 * 数据判据放在 sha 之前是有意的：漂移是最常见的失败，也是最该给出「重新封板」提示的那一类，
 * 而且它只需要几次 git 调用。
 */
export function baselineUsable(): BaselineUsage {
  const state = readManifestState()
  if (state.kind === 'missing') {
    return { kind: 'missing' }
  }
  if (state.kind === 'unusable') {
    return { kind: 'invalid', reason: state.reason }
  }

  const manifest = state.manifest
  if (manifest.dataDirty) {
    return {
      kind: 'invalid',
      reason:
        '封板清单记录了 dataDirty=true（封板时数据路径有未提交改动）—— 这份基线的数据无法证明与仓库一致',
    }
  }

  // 跨 profile 配对（v3）：清单里的库名 / profile 必须与当前 profile 一致。放在 sha 之前 ——
  // 「把 smoke 的 dump 拷进 risk 目录」是最容易发生的一种误配，报错要直接说清。
  if (manifest.profile !== STACK_PROFILE.name || manifest.database !== E2E_PG_DB) {
    return {
      kind: 'invalid',
      reason:
        `封板清单属于 profile=${manifest.profile} / 库=${manifest.database}，` +
        `而当前是 profile=${STACK_PROFILE.name} / 库=${E2E_PG_DB} —— 跨 profile 的基线不能恢复` +
        '（设计稿 P1-6：每个 profile 一套基线三件套）',
    }
  }

  const snapshot = currentDataSnapshot()
  if (snapshot.dirtyPaths.length > 0 || snapshot.dataKey !== manifest.dataKey) {
    return { kind: 'drifted', manifest, dataKey: snapshot.dataKey, dirtyPaths: snapshot.dirtyPaths }
  }

  assertBaselineFilesMatch(manifest)
  return { kind: 'usable', manifest }
}

function readBaselineCredentials(manifest: BaselineManifest): BaselineCredentials {
  assertBaselineFilesMatch(manifest)
  const parsed = JSON.parse(
    readFileSync(BASELINE_CREDENTIALS_FILE, 'utf8'),
  ) as Partial<BaselineCredentials>
  if (
    typeof parsed.userName !== 'string' ||
    typeof parsed.password !== 'string' ||
    parsed.password === ''
  ) {
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
async function readSealFacts(): Promise<{
  migrationsHead: BaselineManifest['migrationsHead']
  menuRows: number
}> {
  const db = await connectDatabase()
  try {
    await assertCurrentDatabase(db)
    const head = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM migrations ORDER BY id DESC LIMIT 1',
    )
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
  } finally {
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
      throw new Error(
        '恢复后的库里没有 admin 账号 —— 基线内容不完整，用 --rebuild-baseline 重新封板',
      )
    }

    const menus = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM sys_menu')
    const menuRows = menus.rows[0]?.count ?? 0
    if (menuRows < manifest.menuRows) {
      throw new Error(
        `恢复后的菜单行数 ${menuRows} < 清单记录的 ${manifest.menuRows} —— 基线内容不完整，用 --rebuild-baseline 重新封板`,
      )
    }

    const head = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM migrations ORDER BY id DESC LIMIT 1',
    )
    const row = head.rows[0]
    if (
      row === undefined ||
      row.id !== manifest.migrationsHead.id ||
      row.name !== manifest.migrationsHead.name
    ) {
      throw new Error(
        `恢复后的迁移头（${row?.id ?? '无'} / ${row?.name ?? '无'}）与清单记录（${manifest.migrationsHead.id} / ${manifest.migrationsHead.name}）不一致 ` +
          '—— dump 与清单不是一对，用 --rebuild-baseline 重新封板',
      )
    }

    await resetRuntimeRolePassword(db)
    return { menuRows }
  } finally {
    await db.end()
  }
}

function removeTempFiles(files: readonly string[]): void {
  for (const file of files) {
    rmSync(file, { force: true })
  }
}

/**
 * 封板：把**已经准备好**的库导出成基线 + 清单。
 *
 * 调用前提：`prepareDatabase()` 刚跑完（迁移、seed、admin 提升为 root、CAP 放宽都已完成）。
 * 顺序（P1-1 原子化）：
 * 1. 读库内事实 + 读出准备阶段写的口令文件（缺任何一项都在**动基线文件之前**失败）；
 * 2. 写数据快照（dataKey / 脏路径）—— 脏封板会记 `dataDirty=true`，之后 restore 会拒绝；
 * 3. `pg_dump -Fc` 到临时文件 → 校验非空 / 算 sha256；
 * 4. 写 credentials 临时文件（0600）→ 算 sha256；
 * 5. 写清单临时文件；
 * 6. **原子提交**：先撤旧清单（此后旧清单不可能配新 dump），再逐个 rename dump / credentials / 清单。
 *
 * 中途失败时：临时文件删掉；若已进入第 6 步，盘上是「没有清单」——下一次 run 会把它识别成
 * 「封板中断的半成品」并拒绝使用（提示重封板），不会静默接受。
 */
export async function sealBaseline(): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  const started = Date.now()
  const facts = await readSealFacts()

  // 先把口令读出来：它缺失时要在**动基线文件之前**失败，否则会出现「新 dump + 旧清单」的半截状态
  if (!existsSync(CREDENTIALS_FILE)) {
    throw new Error(
      `封板前必须有 ${CREDENTIALS_FILE}（prepareDatabase 会写）—— 找不到说明 prepare 没跑完`,
    )
  }
  const credentials = JSON.parse(
    readFileSync(CREDENTIALS_FILE, 'utf8'),
  ) as Partial<BaselineCredentials>
  if (
    typeof credentials.userName !== 'string' ||
    typeof credentials.password !== 'string' ||
    credentials.password === ''
  ) {
    throw new Error(
      `${CREDENTIALS_FILE} 里没有 userName/password —— 拒绝封板（快照里的口令身份需要它）`,
    )
  }

  const snapshot = currentDataSnapshot()
  if (snapshot.dirtyPaths.length > 0) {
    warn(
      '封板时数据路径有未提交改动（清单会记 dataDirty=true，之后 restore 会拒绝这份基线）：\n' +
        `  ${snapshot.dirtyPaths.join('\n  ')}\n` +
        '  处置：提交 / 还原这些改动后重新封板（本轮仍会跑完用例，但这份基线只用于本轮）。',
    )
  }

  const tmpDump = `${BASELINE_DUMP_FILE}.tmp`
  const tmpCredentials = `${BASELINE_CREDENTIALS_FILE}.tmp`
  const tmpManifest = `${BASELINE_MANIFEST_FILE}.tmp`
  const tempFiles = [tmpDump, tmpCredentials, tmpManifest]
  removeTempFiles(tempFiles)

  const container = resolvePgContainer()
  const dumpStarted = Date.now()
  try {
    runPgDumpToFile(container, tmpDump)
  } catch (error) {
    removeTempFiles(tempFiles)
    throw new Error(
      `pg_dump 失败，基线未更新：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const dumpMs = Date.now() - dumpStarted

  const dumpBytes = statSync(tmpDump).size
  if (dumpBytes === 0) {
    removeTempFiles(tempFiles)
    throw new Error('pg_dump 产出了空文件 —— 拒绝写清单（旧基线保持原样）')
  }
  const dumpSha256 = sha256File(tmpDump)

  writeFileSync(
    tmpCredentials,
    `${JSON.stringify({ userName: credentials.userName, password: credentials.password }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  const credentialsBytes = statSync(tmpCredentials).size
  const credentialsSha256 = sha256File(tmpCredentials)

  const manifest: BaselineManifest = {
    manifestVersion: MANIFEST_VERSION,
    sealedAt: new Date().toISOString(),
    gitCommit: gitHead(),
    profile: STACK_PROFILE.name,
    database: E2E_PG_DB,
    dataKey: snapshot.dataKey,
    dataDirty: snapshot.dirtyPaths.length > 0,
    migrationsHead: facts.migrationsHead,
    dumpSha256,
    dumpBytes,
    credentialsSha256,
    credentialsBytes,
    menuRows: facts.menuRows,
  }
  writeFileSync(tmpManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })

  // ── 原子提交：先撤旧清单，再逐个 rename；任何故障都不会留下「新 dump + 旧清单」 ──
  try {
    rmSync(BASELINE_MANIFEST_FILE, { force: true })
    renameSync(tmpDump, BASELINE_DUMP_FILE)
    renameSync(tmpCredentials, BASELINE_CREDENTIALS_FILE)
    renameSync(tmpManifest, BASELINE_MANIFEST_FILE)
  } catch (error) {
    removeTempFiles(tempFiles)
    throw new Error(
      `封板提交阶段失败（旧清单已撤下，盘上是没有清单的半成品；下一次 run 会拒绝使用并提示重封板）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }

  log(
    `seal 完成：${path.basename(BASELINE_DUMP_FILE)} ${dumpBytes} B（pg_dump ${formatSeconds(dumpMs)}，容器 ${container}，总 ${formatSeconds(Date.now() - started)}）`,
  )
  log(
    `清单 v${MANIFEST_VERSION}：profile=${manifest.profile}、库=${manifest.database}、HEAD ${shortSha(manifest.gitCommit)}、dataKey ${shortSha(manifest.dataKey)}${manifest.dataDirty ? '（脏）' : ''}、迁移头 ${facts.migrationsHead.id}（${facts.migrationsHead.name}）、菜单 ${facts.menuRows} 行、dump sha ${dumpSha256.slice(0, 12)}…、credentials sha ${credentialsSha256.slice(0, 12)}…`,
  )
  log(`基线文件与清单都在 gitignored 的 ${ARTIFACT_DIR}/（不入库）：${BASELINE_DUMP_FILE}`)
}

/**
 * restore：从基线恢复 `walnut_e2e`，然后补上**不在快照里**的运行时状态。
 *
 * 校验顺序（**全部在 DROP DATABASE 之前**）：清单形态 → dump / credentials 的字节数与 sha
 * （{@link assertBaselineFilesMatch}）→ 读出封板口令。任何一项不通过都不动库。
 *
 * 这里的 `--clean --if-exists` 在「刚 DROP/CREATE 过的空库」上是一段无害的 no-op；保留它是因为
 * 恢复流程不应假设调用方一定清过库 —— 若将来有人在非空库上恢复，它至少不会撞「对象已存在」。
 */
export async function restoreBaseline(options: { maintenance: Client }): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  const state = readManifestState()
  if (state.kind !== 'ok') {
    const detail =
      state.kind === 'unusable' ? state.reason : `没有封板清单（${BASELINE_MANIFEST_FILE}）`
    throw new E2ePreconditionError(
      `${detail} —— 用 \`node scripts/run.ts --rebuild-baseline\` 重新封板`,
    )
  }
  const manifest = state.manifest
  // 直接调用 restoreBaseline 的路径（不带 baselineUsable）也要过 profile 配对：跨 profile 的 dump
  // 即使 sha 全对，也不能恢复进当前库。
  if (manifest.profile !== STACK_PROFILE.name || manifest.database !== E2E_PG_DB) {
    throw new E2ePreconditionError(
      `拒绝恢复：封板清单属于 profile=${manifest.profile} / 库=${manifest.database}，` +
        `当前是 profile=${STACK_PROFILE.name} / 库=${E2E_PG_DB}`,
    )
  }
  const credentials = readBaselineCredentials(manifest)

  const container = resolvePgContainer()
  const started = Date.now()
  log(`DROP DATABASE IF EXISTS ${E2E_PG_DB} WITH (FORCE) → CREATE DATABASE（先清空目标库）`)
  await options.maintenance.query(`DROP DATABASE IF EXISTS "${E2E_PG_DB}" WITH (FORCE)`)
  await options.maintenance.query(`CREATE DATABASE "${E2E_PG_DB}"`)

  log(
    `pg_restore（容器 ${container}，${path.basename(BASELINE_DUMP_FILE)} ${manifest.dumpBytes} B）`,
  )
  try {
    runPgRestoreFromFile(container, readFileSync(BASELINE_DUMP_FILE))
  } catch (error) {
    throw new Error(
      `从基线恢复失败：${error instanceof Error ? error.message : String(error)}\n` +
        '  基线只对「同一套数据栈 + 同一份封板清单」有效；换过数据卷 / 清过库时旧基线不再适用 ' +
        '—— 用 `node scripts/run.ts --rebuild-baseline` 重新封板',
    )
  }

  const facts = await finalizeRestoredDatabase(manifest)
  writeRestoredCredentials(credentials)
  await clearAppSettingCache()

  log(
    `restore 完成（${formatSeconds(Date.now() - started)}）：迁移头 ${manifest.migrationsHead.id}、菜单 ${facts.menuRows} 行、admin 存在；` +
      `已重置 ${E2E_PG_APP_USER} 口令、清 Redis 设置缓存、写 ${CREDENTIALS_FILE}（口令取封板时那一份）`,
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
 * | 有基线但 dataKey 变了 / 数据路径脏 | **抛前置错误（退出码 2）**，提示重新封板 |
 * | 基线文件 / 清单对不上（含旧版本 / 半成品） | **抛前置错误（退出码 2）**，提示重新封板 |
 * | 基线有效且 dataKey 一致且数据路径干净 | restore（不跑迁移 / seed） |
 */
export async function ensureTestDatabase(
  options: EnsureTestDatabaseOptions,
): Promise<DatabaseMode> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  if (options.skipBaseline === true && options.rebuild === true) {
    throw new E2ePreconditionError(
      'E2E_SKIP_BASELINE=1 与 --rebuild-baseline / E2E_REBUILD_BASELINE=1 互斥：' +
        '前者「忽略基线」，后者「重新封板」，同时给无法判断你想要哪个。去掉一个再跑。',
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
      `基线有效（封板于 ${usage.manifest.sealedAt}，profile ${usage.manifest.profile}，HEAD ${shortSha(usage.manifest.gitCommit)}，` +
        `dataKey ${shortSha(usage.manifest.dataKey)}，迁移头 ${usage.manifest.migrationsHead.id}，菜单 ${usage.manifest.menuRows} 行）` +
        '→ 从基线恢复（不跑迁移 / seed）',
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
      `基线不可用：${usage.reason}。\n` +
        '  运行 `node scripts/run.ts --rebuild-baseline` 重新封板（或 `E2E_SKIP_BASELINE=1` 跳过基线、退回全量 prepare）',
    )
  }

  const dirty =
    usage.dirtyPaths.length > 0
      ? `\n  数据路径有未提交改动（先提交 / 还原，或直接 --rebuild-baseline）：\n    ${usage.dirtyPaths.join('\n    ')}`
      : ''
  throw new E2ePreconditionError(
    `迁移 / seed 等数据路径相对封板时已变化（封板 HEAD ${shortSha(usage.manifest.gitCommit)} / dataKey ${shortSha(usage.manifest.dataKey)}，` +
      `当前 dataKey ${shortSha(usage.dataKey)}）。${dirty}\n` +
      '  一条命令重建基线并继续：`pnpm --filter @walnut/e2e e2e -- --rebuild-baseline`（或 `node apps/e2e/scripts/run.ts --rebuild-baseline`）\n' +
      `  数据路径清单见 apps/e2e/scripts/e2e-data-paths.ts 的 E2E_DATA_PATHS（${DATA_PATHS.length} 项）；` +
      '`E2E_SKIP_BASELINE=1` 可临时跳过基线、退回全量 prepare（不封板）',
  )
}
