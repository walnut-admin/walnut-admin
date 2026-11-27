/**
 * E2E 库准备：**advisory lock → DROP/CREATE walnut_e2e → 迁移 → seed → 提升 admin 为 root**。
 *
 * 为什么必须在 `playwright test` 之前跑（而不是 globalSetup）：Playwright 的 webServer
 * **先于** globalSetup 启动（官方已知顺序），而 webServer 里的后端一连库就会跑应用初始化
 * （TypeORM 实体 / RLS 连接）。库还不存在时它直接失败，Playwright 会当成「webServer 起不来」
 * 超时。所以建库 / 迁移 / seed 只能放在 `e2e` 脚本的第一段。
 *
 * 两套入口，同一段逻辑（{@link prepareDatabase}）：
 * - `pnpm --filter @walnut/e2e e2e` 走 `scripts/run.ts`：它**先抢锁并整轮持有**，再把这件
 *   事原样传进来（`lockHeld: true`）—— 锁要罩住 playwright test，否则两个 worktree 并发时
 *   后一个准备进程会把前一个正在用的库删掉；
 * - 单独 `node scripts/prepare-db.ts`：自己抢锁、自己在结束时放（只罩住重建那一段）。
 *
 * 顺序与判据：
 * 1. 写迁移通道 env（`apps/server/env-local/.env.e2e`）与 seed env（`.e2e/e2e.env`，= .env.stage
 *    副本 + 独立库覆盖）；两者都是前置条件产物，缺 .env.stage 直接按「环境没准备好」退出；
 * 2. `DROP DATABASE IF EXISTS walnut_e2e WITH (FORCE)` + `CREATE DATABASE`（全新状态）；
 * 3. `migration:run`：typeorm CLI 只认 `apps/server/env-local/.env.${NODE_ENV}`，所以让子进程
 *    NODE_ENV=e2e；
 * 4. `db:seed:pg --admin admin --password <随机>`：`--env-file` 指向 `.e2e/e2e.env`。
 *    **OPAQUE 口令必须用后端实际使用的 AUTH_OPAQUE_SECRET 生成**，所以不能只给
 *    DATABASE_PG_*，必须整份拷贝；seed 成功（或失败）之后立刻删掉这份含密钥的副本；
 * 5. 提升 root：删其它角色 junction、插 root junction、role_mode='combinable'、
 *    current_role_id=root、补齐 sys_role_menu（角色真源在 seed 的 sys_role.json；
 *    root 走 permission guard 短路，但菜单/侧边栏仍按 junction 算，补齐才不留空壳）；
 * 6. 写 `.auth/credentials.json`（口令；TOTP secret 由 stack.setup 绑定后补上）。
 *
 * 不提交、不推送：所有产物都落在 gitignored 的 .e2e/ 与 .auth/（以及 apps/server/env-local）。
 *
 * **profile（P1-6 Phase A）**：库名 / 端口 / 凭据 / 基线目录都来自 `scripts/stack-profiles.ts`
 * （`E2E_STACK_PROFILE` 选择）。`apps/server/env-local/.env.e2e` 是 typeorm CLI 的**固定路径**，
 * 所以同一个 checkout 上不能并发两个 profile 的 prepare —— 本地由全局锁串行保证，CI 每个 job
 * 独立 checkout。别为了「并行」去猜 CLI 的其它路径。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
  ARTIFACT_DIR,
  assertE2eDatabase,
  assertE2ePgPort,
  AUTH_DIR,
  CREDENTIALS_FILE,
  E2E_ENV_FILE,
  E2E_PG_APP_PASS,
  E2E_PG_APP_USER,
  E2E_PG_DB,
  E2E_PG_HOST,
  E2E_PG_PASS,
  E2E_PG_PORT,
  E2E_PG_USER,
  E2E_REDIS_HOST,
  E2E_REDIS_PORT,
  parseEnvFile,
  REPO_ROOT,
  SERVER_E2E_ENV_FILE,
  SERVER_ROOT,
  SERVER_STAGE_ENV_FILE,
} from './env.ts'
import { E2ePreconditionError, reportFailure } from './failure.ts'
import { acquirePgLock, connectMaintenance, E2E_PG_LOCK_KEY, E2E_PROFILE_LOCK_KEY, releasePgLock } from './pg-lock.ts'
import { runPnpm } from './pnpm.ts'
import { clearAppSettingCache, resetRuntimeRolePassword } from './runtime-reset.ts'
import { STACK_PROFILE } from './stack-profiles.ts'

function log(message: string): void {
  console.log(`[e2e/prepare-db] ${message}`)
}

/**
 * 生成传给 typeorm CLI 的 env 文件：只放 DATABASE_PG_*（data-source.cli 只读这 5 个键）。
 * 写到 apps/server/env-local/.env.e2e 是**唯一可行**的通道 —— CLI 用 `process.cwd()/env-local`
 * 定位文件，没有 `--env-file` 参数。
 *
 * 这个文件**含数据库口令**：0600 权限（POSIX 上生效；Windows 的 Node 会忽略 mode，见 README），
 * 文件头写「勿提交」，且迁移一结束就删（{@link prepareDatabase} 的 finally）——
 * 不让它比必要的生命周期多留在盘上。
 */
function writeServerMigrationEnv(): void {
  const lines = [
    '# 由 apps/e2e/scripts/prepare-db.ts 生成（gitignored）：E2E 独立库的迁移通道。',
    '# 含数据库口令，勿提交、勿复制分享；迁移跑完即删（见 prepare-db.ts）。',
    `DATABASE_PG_HOST=${E2E_PG_HOST}`,
    `DATABASE_PG_PORT=${E2E_PG_PORT}`,
    `DATABASE_PG_USER=${E2E_PG_USER}`,
    `DATABASE_PG_PASS=${E2E_PG_PASS}`,
    `DATABASE_PG_NAME=${E2E_PG_DB}`,
    '',
  ]
  mkdirSync(`${SERVER_ROOT}/env-local`, { recursive: true })
  writeFileSync(SERVER_E2E_ENV_FILE, lines.join('\n'), { encoding: 'utf8', mode: 0o600 })
  log(`已写 ${SERVER_E2E_ENV_FILE}（含 DB 口令，0600；迁移结束即删）`)
}

/**
 * 生成 seed 的 env 文件：.env.stage 的**整份副本** + 独立库覆盖。
 *
 * 为什么整份拷贝而不是只写 DATABASE_PG_*：`db:seed:pg --admin` 还要从同一个文件读
 * AUTH_OPAQUE_SECRET —— 口令身份必须用后端实际使用的 OPAQUE 密钥生成，否则登录握手
 * 在客户端就返回 undefined（「口令错」的假象）。
 *
 * 这份文件含密钥，所以：0600 权限（只有本用户可读）、且只在 prepare 期间存在
 * （见 {@link prepareDatabase} 里 seed 之后的删除）。
 */
function writeSeedEnv(): void {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  if (!existsSync(SERVER_STAGE_ENV_FILE)) {
    throw new E2ePreconditionError(
      `找不到 ${SERVER_STAGE_ENV_FILE} —— 先跑 \`pnpm setup-env\` 解密 apps/server/env-local/（需要根 .env.keys）`,
    )
  }

  const overrides: Record<string, string> = {
    DATABASE_PG_HOST: E2E_PG_HOST,
    DATABASE_PG_PORT: String(E2E_PG_PORT),
    DATABASE_PG_USER: E2E_PG_USER,
    DATABASE_PG_PASS: E2E_PG_PASS,
    DATABASE_PG_NAME: E2E_PG_DB,
    DATABASE_PG_APP_USER: E2E_PG_APP_USER,
    DATABASE_PG_APP_PASS: E2E_PG_APP_PASS,
    APP_REDIS_HOST: E2E_REDIS_HOST,
    APP_REDIS_PORT: String(E2E_REDIS_PORT),
  }

  const kept: string[] = []
  const written = new Set<string>()
  for (const raw of readFileSync(SERVER_STAGE_ENV_FILE, 'utf8').split(/\r?\n/)) {
    const key = raw.includes('=') ? raw.slice(0, raw.indexOf('=')).trim() : ''
    if (key in overrides) {
      if (!written.has(key)) {
        kept.push(`${key}=${overrides[key]}`)
        written.add(key)
      }
      continue
    }
    kept.push(raw)
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!written.has(key)) {
      kept.push(`${key}=${value}`)
    }
  }

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  writeFileSync(E2E_ENV_FILE, `${kept.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  log(`已写 ${E2E_ENV_FILE}（.env.stage 副本 + 独立库覆盖；含 AUTH_OPAQUE_SECRET，gitignored，0600）`)

  // 自检：覆盖真的写进去了（免得 seed 静默连到 dev）
  const parsed = parseEnvFile(readFileSync(E2E_ENV_FILE, 'utf8'))
  if (parsed.DATABASE_PG_NAME !== E2E_PG_DB || Number.parseInt(parsed.DATABASE_PG_PORT) !== E2E_PG_PORT) {
    throw new Error('生成的 seed env 指向了非 E2E 库 —— 覆盖失败，拒绝继续')
  }
  assertE2eDatabase(parsed.DATABASE_PG_NAME)
}

/**
 * 提升 admin 为 root（与 apps/server/apps/api/test/api/helpers/auth-login.ts 的
 * registerRootUserFixture 同一套判据，只是对象换成 seed 出来的 admin）：
 * - `role_mode='combinable'` + `current_role_id=<root>` ⇒ AT payload 的 roleNames[0]='root'，
 *   permission guard 短路（不需要逐条权限）；
 * - 删掉其它 junction（尤其 seed 给 admin 的 `admin` 角色）—— COMBINE 模式按 junction
 *   实时算 roleNames，残留会在 root 前面出现；
 * - `sys_role_menu` 补齐：菜单树 / 侧边栏按 junction 算（root 只短路**权限字符串**）。
 */
async function promoteAdminToRoot(client: Client, userName: string): Promise<{ userId: string, roleId: string }> {
  const userRows = await client.query<{ id: string }>('SELECT id FROM sys_user WHERE user_name = $1', [userName])
  const userId = userRows.rows[0]?.id
  if (userId === undefined) {
    throw new Error(`seed 之后库里没有账号 ${userName}（seed 的 sys_user.json 应含 admin）`)
  }

  const roleRows = await client.query<{ id: string }>('SELECT id FROM sys_role WHERE role_name = $1', ['root'])
  const roleId = roleRows.rows[0]?.id
  if (roleId === undefined) {
    throw new Error('seed 之后库里没有 root 角色（sys_role.json 应有 role_name=root）')
  }

  await client.query('DELETE FROM sys_user_role WHERE user_id = $1', [userId])
  await client.query('INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)', [userId, roleId])
  await client.query(
    `UPDATE sys_user
        SET role_mode = 'combinable', current_role_id = $2, mfa_setup = false, status = true
      WHERE id = $1`,
    [userId, roleId],
  )
  const menuResult = await client.query(
    'INSERT INTO sys_role_menu (role_id, menu_id) SELECT $1, id FROM sys_menu ON CONFLICT DO NOTHING',
    [roleId],
  )

  log(`admin → root 完成：user=${userId} role=${roleId}，补齐 sys_role_menu ${menuResult.rowCount ?? 0} 行`)
  return { userId, roleId }
}

/**
 * CAP 在**本栈库**里的测试放宽（只改 `app_setting` 设置行，不动源码，生产零影响）。
 *
 * 两项，都有独立的、可复核的理由（不变量 9「放宽只改库」）：
 *
 * 1. **节流频率**：cap.js 的 challenge/redeem 也挂着
 *    `@WalnutAdminDecoratorThrottle(SecurityCapSettingService)`，seed 的
 *    `app.global.capjs.config` 是 `throttleLimit: 4`（4 次/60s per realIp）。一次 solve 就是
 *    challenge + redeem 两个请求，而设备用例通常要 **两次** solve（bootstrap 一次、登录触发
 *    一次）—— 余量为零，实测会把 cap-widget 打进错误态（"你是人类吗？"）并卡住 60s。
 * 2. **PoW 难度 4 → 2**（R-C O2，经所有者批准）：`difficulty: 4` 的期望工作量是 16^4 次哈希，
 *    Node 侧单次 solve 实测 ~1.4s，一轮 default 面 ~54 次 solve 合计 ~60s。难度是**配置**，
 *    不是 CAP 协议语义：这一层要验的是「challenge → PoW → redeem → 40116 → 交互 → 重放」，
 *    不是 16^4 的工作量。`difficulty: 2` 时期望 256 次哈希（毫秒级），整轮省 ~60s。
 *    E2E 仍然**完整走 CAP 协议**（真 challenge、真 WASM 求解、真 token、真重放），
 *    只是工作量降档；难度相关的性能 / 超时问题属于服务端负载测试的面，不是 E2E 的面。
 *
 * 只改这两个键（count / size / ttl 原样）—— 别把测试专用的其它值写进源码。
 */
async function relaxCapForTests(client: Client): Promise<void> {
  const key = 'app.global.capjs.config'
  const { rows } = await client.query<{ setting_value: string }>(
    'SELECT setting_value FROM app_setting WHERE setting_key = $1',
    [key],
  )
  const raw = rows[0]?.setting_value
  if (raw === undefined) {
    throw new Error(`seed 里没有 ${key} 设置行（app_setting.json）`)
  }

  const config = JSON.parse(raw) as Record<string, unknown>
  config.throttleLimit = 10000
  config.difficulty = 2
  await client.query('UPDATE app_setting SET setting_value = $1 WHERE setting_key = $2', [JSON.stringify(config), key])
  log(`已放宽 ${key}：throttleLimit → 10000、difficulty → 2（仅本栈库；E2E 仍完整走 CAP 协议）`)
}

/**
 * 重建 E2E 库并播好数据。**可复用**：`scripts/run.ts` 在持有 run 级锁时调它
 * （`lockHeld: true`），独立入口在文件末尾。
 *
 * 它产出的库是**封板快照的内容真源**（scripts/baseline.ts 的 seal 紧接着把它导出成基线）：
 * 迁移、seed、admin 提升为 root、CAP 放宽都在这里完成；每轮仍需重做的运行时状态
 * （`walnut_app` 口令 / Redis 设置缓存）走 scripts/runtime-reset.ts，restore 路径也调它。
 */
export async function prepareDatabase(options: { lockHeld?: boolean } = {}): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  const started = Date.now()
  const password = `E2e-${randomBytes(12).toString('hex')}`
  writeServerMigrationEnv()
  writeSeedEnv()

  mkdirSync(AUTH_DIR, { recursive: true })
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  const maintenance = await connectMaintenance()
  const ownsLock = options.lockHeld !== true

  try {
    if (ownsLock) {
      // 独立入口：与 run.ts 同一嵌套口径 —— 先全局锁（不变量 6），再 profile 锁
      await acquirePgLock(maintenance, E2E_PG_LOCK_KEY, 'global')
      if (E2E_PROFILE_LOCK_KEY !== E2E_PG_LOCK_KEY) {
        await acquirePgLock(maintenance, E2E_PROFILE_LOCK_KEY, `profile=${STACK_PROFILE.name}`)
      }
    }

    log(`DROP DATABASE IF EXISTS ${E2E_PG_DB} WITH (FORCE)`)
    await maintenance.query(`DROP DATABASE IF EXISTS "${E2E_PG_DB}" WITH (FORCE)`)
    log(`CREATE DATABASE ${E2E_PG_DB}`)
    await maintenance.query(`CREATE DATABASE "${E2E_PG_DB}"`)

    // 迁移：typeorm CLI 只读 env-local/.env.e2e（见 writeServerMigrationEnv）
    log('跑迁移（NODE_ENV=e2e → apps/server/env-local/.env.e2e）')
    try {
      runPnpm(['run', 'migration:run'], SERVER_ROOT, { ...process.env, NODE_ENV: 'e2e' }, 'migration:run')
    }
    finally {
      // 迁移通道文件含 DB 口令：一跑完（无论成败）就删，与 .e2e/e2e.env 同处置
      rmSync(SERVER_E2E_ENV_FILE, { force: true })
    }

    // seed：--env-file 指向整份拷贝（AUTH_OPAQUE_SECRET 必须与后端同源）。
    // 跑完立刻删掉这份含密钥的副本 —— 它唯一的消费者是 seed 自己。
    log('播 seed + 建 admin 口令身份（db:seed:pg --admin admin）')
    try {
      runPnpm(
        ['exec', 'walnut-db-seed-pg', '--env-file', E2E_ENV_FILE, '--admin', 'admin', '--password', password],
        REPO_ROOT,
        { ...process.env },
        'db:seed:pg --admin',
      )
    }
    finally {
      rmSync(E2E_ENV_FILE, { force: true })
    }

    const db = new Client({
      host: E2E_PG_HOST,
      port: E2E_PG_PORT,
      user: E2E_PG_USER,
      password: E2E_PG_PASS,
      database: E2E_PG_DB,
    })
    await db.connect()
    try {
      await promoteAdminToRoot(db, 'admin')
      await relaxCapForTests(db)
      // 运行时角色口令不在快照里（角色是集群级的），每轮由这里/restore 重置
      await resetRuntimeRolePassword(db)
    }
    finally {
      await db.end()
    }

    writeFileSync(
      CREDENTIALS_FILE,
      `${JSON.stringify({ userName: 'admin', password, totpSecret: '' }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    log(`已写 ${CREDENTIALS_FILE}（口令随机生成、0600；TOTP secret 由 stack.setup 绑定后补上）`)
    await clearAppSettingCache()
    log(`完成：库已重建、seed 已播、admin 已提升为 root、CAP 已放宽（节流 + 难度；全量 prepare 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
  }
  finally {
    // seed env 含 AUTH_OPAQUE_SECRET、迁移 env 含 DB 口令：正常路径下各自一结束就删了，
    // 这里是异常路径（提前抛错）的兜底 —— 不让这两份副本在盘上多留一轮。
    rmSync(E2E_ENV_FILE, { force: true })
    rmSync(SERVER_E2E_ENV_FILE, { force: true })
    if (ownsLock) {
      if (E2E_PROFILE_LOCK_KEY !== E2E_PG_LOCK_KEY) {
        await releasePgLock(maintenance, E2E_PROFILE_LOCK_KEY)
      }
      await releasePgLock(maintenance, E2E_PG_LOCK_KEY)
    }
    await maintenance.end().catch(() => {})
  }
}

/** 独立入口才跑（`scripts/run.ts` 会 import 本文件的 prepareDatabase，不能连带着执行一次） */
const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  prepareDatabase().catch((error) => {
    process.exitCode = reportFailure('e2e/prepare-db', error)
  })
}
