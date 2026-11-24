import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
/**
 * E2E 库准备：**advisory lock → DROP/CREATE walnut_e2e → 迁移 → seed → 提升 admin 为 root**。
 *
 * 为什么必须在 `playwright test` 之前跑（而不是 globalSetup）：Playwright 的 webServer
 * **先于** globalSetup 启动（官方已知顺序），而 webServer 里的后端一连库就会跑应用初始化
 * （TypeORM 实体 / RLS 连接）。库还不存在时它直接失败，Playwright 会当成「webServer 起不来」
 * 超时。所以建库 / 迁移 / seed 只能放在 `e2e` 脚本的第一段。
 *
 * 顺序与判据：
 * 1. 安全闸：库名必须逐字 walnut_e2e、端口必须 5433（见 scripts/env.ts 的 assert*）；
 * 2. PG advisory lock（与集成测试同一手法）：同一 worktree 并发跑两个 prepare 会互删库；
 * 3. `DROP DATABASE IF EXISTS walnut_e2e WITH (FORCE)` + `CREATE DATABASE`（全新状态）；
 * 4. `migration:run`：typeorm CLI 只认 `apps/server/env-local/.env.${NODE_ENV}`，所以本脚本
 *    生成 `apps/server/env-local/.env.e2e`（gitignored）并让子进程 NODE_ENV=e2e；
 * 5. `db:seed:pg --admin admin --password <随机>`：`--env-file` 指向本脚本生成的
 *    `.e2e/e2e.env`（= .env.stage 副本 + 独立库覆盖）。**OPAQUE 口令必须用后端实际使用的
 *    AUTH_OPAQUE_SECRET 生成**，所以不能只给 DATABASE_PG_*，必须整份拷贝；
 * 6. 提升 root：删其它角色 junction、插 root junction、role_mode='combinable'、
 *    current_role_id=root、补齐 sys_role_menu（角色真源在 seed 的 sys_role.json；
 *    root 走 permission guard 短路，但菜单/侧边栏仍按 junction 算，补齐才不留空壳）；
 * 7. 写 `.auth/credentials.json`（口令；TOTP secret 由 stack.setup 绑定后补上）。
 *
 * 不提交、不推送：所有产物都落在 gitignored 的 .e2e/ 与 .auth/（以及 apps/server/env-local）。
 */
import process from 'node:process'
import { Client } from 'pg'
import { createClient } from 'redis'
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
  E2E_REDIS_PASS,
  E2E_REDIS_PORT,
  parseEnvFile,
  REPO_ROOT,
  SERVER_E2E_ENV_FILE,
  SERVER_ROOT,
  SERVER_STAGE_ENV_FILE,
} from './env.ts'

/** advisory lock 的 key（任意固定大整数；只在 E2E 内使用，别与集成测试的 key 撞） */
const E2E_PG_LOCK_KEY = 2026112401
/** 抢锁等待上限：超过就报「谁在持锁」而不是无限等 */
const LOCK_WAIT_MS = 120_000
const LOCK_POLL_MS = 2_000
/** 管理通道连到维护库（DROP/CREATE DATABASE 不能连目标库本身） */
const MAINTENANCE_DB = 'postgres'

function log(message: string): void {
  console.log(`[e2e/prepare-db] ${message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 经 pnpm 跑子进程。
 *
 * `npm_execpath` 的形态**因安装方式而异**：pnpm 自己的 bin 可能是**可执行文件**
 * （本机 corepack/nvm 布局里是 `pnpm.exe`），也可能是 `.cjs`。把 `.exe` 交给 `node` 去跑
 * 会得到「Command failed」而没有任何有用信息（实测：`node pnpm.exe run migration:run`
 * 直接非零退出），所以按扩展名分三路：js 用 node、exe 直接执行、其余（.cmd/.bat/无扩展名）
 * 交给 shell。手工 `node scripts/prepare-db.ts` 时没有 npm_execpath，走最后的 shell 路。
 */
function runPnpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const execpath = process.env.npm_execpath

  if (execpath !== undefined && /\.[cm]?js$/i.test(execpath)) {
    execFileSync(process.execPath, [execpath, ...args], { cwd, env, stdio: 'inherit' })
    return
  }

  if (execpath !== undefined && /\.exe$/i.test(execpath)) {
    execFileSync(execpath, [...args], { cwd, env, stdio: 'inherit' })
    return
  }

  execFileSync('pnpm', args, { cwd, env, stdio: 'inherit', shell: true })
}

/**
 * 生成传给 typeorm CLI 的 env 文件：只放 DATABASE_PG_*（data-source.cli 只读这 5 个键）。
 * 写到 apps/server/env-local/.env.e2e 是**唯一可行**的通道 —— CLI 用 `process.cwd()/env-local`
 * 定位文件，没有 `--env-file` 参数。
 */
function writeServerMigrationEnv(): void {
  const lines = [
    '# 由 apps/e2e/scripts/prepare-db.ts 生成（gitignored）：E2E 独立库的迁移通道。',
    `DATABASE_PG_HOST=${E2E_PG_HOST}`,
    `DATABASE_PG_PORT=${E2E_PG_PORT}`,
    `DATABASE_PG_USER=${E2E_PG_USER}`,
    `DATABASE_PG_PASS=${E2E_PG_PASS}`,
    `DATABASE_PG_NAME=${E2E_PG_DB}`,
    '',
  ]
  mkdirSync(`${SERVER_ROOT}/env-local`, { recursive: true })
  writeFileSync(SERVER_E2E_ENV_FILE, lines.join('\n'), 'utf8')
  log(`已写 ${SERVER_E2E_ENV_FILE}`)
}

/**
 * 生成 seed 的 env 文件：.env.stage 的**整份副本** + 独立库覆盖。
 *
 * 为什么整份拷贝而不是只写 DATABASE_PG_*：`db:seed:pg --admin` 还要从同一个文件读
 * AUTH_OPAQUE_SECRET —— 口令身份必须用后端实际使用的 OPAQUE 密钥生成，否则登录握手
 * 在客户端就返回 undefined（「口令错」的假象）。
 */
function writeSeedEnv(): void {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  if (!existsSync(SERVER_STAGE_ENV_FILE)) {
    throw new Error(`[e2e] 找不到 ${SERVER_STAGE_ENV_FILE} —— 先跑 \`pnpm setup-env\``)
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
  writeFileSync(E2E_ENV_FILE, `${kept.join('\n')}\n`, 'utf8')
  log(`已写 ${E2E_ENV_FILE}（.env.stage 副本 + 独立库覆盖；含 AUTH_OPAQUE_SECRET，gitignored）`)

  // 自检：覆盖真的写进去了（免得 seed 静默连到 dev）
  const parsed = parseEnvFile(readFileSync(E2E_ENV_FILE, 'utf8'))
  if (parsed.DATABASE_PG_NAME !== E2E_PG_DB || Number.parseInt(parsed.DATABASE_PG_PORT) !== E2E_PG_PORT) {
    throw new Error('[e2e] 生成的 seed env 指向了非 E2E 库 —— 覆盖失败，拒绝继续')
  }
  assertE2eDatabase(parsed.DATABASE_PG_NAME)
}

/** PG advisory lock（try 轮询；抢不到时打印持锁者，而不是静默等待） */
async function acquireLock(client: Client): Promise<void> {
  const started = Date.now()

  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [E2E_PG_LOCK_KEY])
    if (rows[0]?.locked === true) {
      log(`已拿到 PG advisory lock（key=${E2E_PG_LOCK_KEY}）`)
      return
    }

    if (Date.now() - started > LOCK_WAIT_MS) {
      const holders = await client.query<{ pid: number, state: string, query: string }>(
        `SELECT a.pid, a.state, a.query
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND l.objid = $1`,
        [E2E_PG_LOCK_KEY],
      )
      const detail = holders.rows.map(row => `pid=${row.pid} state=${row.state} query=${row.query.slice(0, 120)}`).join('; ')
      throw new Error(`[e2e] ${LOCK_WAIT_MS / 1000}s 内没抢到 PG advisory lock —— 另一个 E2E 准备进程正在跑？${detail}`)
    }

    log('另一个 E2E 准备进程持锁中，2s 后重试……')
    await sleep(LOCK_POLL_MS)
  }
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
    throw new Error(`[e2e] seed 之后库里没有账号 ${userName}（seed 的 sys_user.json 应含 admin）`)
  }

  const roleRows = await client.query<{ id: string }>('SELECT id FROM sys_role WHERE role_name = $1', ['root'])
  const roleId = roleRows.rows[0]?.id
  if (roleId === undefined) {
    throw new Error('[e2e] seed 之后库里没有 root 角色（sys_role.json 应有 role_name=root）')
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
 * CAP 端点的节流放宽（**只改本栈库里的设置行**，不动源码）。
 *
 * cap.js 的 challenge/redeem 也挂着 `@WalnutAdminDecoratorThrottle(SecurityCapSettingService)`，
 * seed 的 `app.global.capjs.config` 是 `throttleLimit: 4`（4 次/60s per realIp）。一次 solve
 * 就是 challenge + redeem 两个请求，而设备用例通常要 **两次** solve（bootstrap 一次、登录
 * 触发一次）—— 余量为零，实测会把 cap-widget 打进错误态（"你是人类吗？"）并卡住 60s。
 * 这里只放宽**频率**：count / size / difficulty / ttl 原样保留，PoW 仍然真解。
 */
async function relaxCapThrottleForTests(client: Client): Promise<void> {
  const key = 'app.global.capjs.config'
  const { rows } = await client.query<{ setting_value: string }>(
    'SELECT setting_value FROM app_setting WHERE setting_key = $1',
    [key],
  )
  const raw = rows[0]?.setting_value
  if (raw === undefined) {
    throw new Error(`[e2e] seed 里没有 ${key} 设置行（app_setting.json）`)
  }

  const config = JSON.parse(raw) as Record<string, unknown>
  config.throttleLimit = 10000
  await client.query('UPDATE app_setting SET setting_value = $1 WHERE setting_key = $2', [JSON.stringify(config), key])
  log(`已放宽 ${key}.throttleLimit → 10000（仅本栈库；PoW 难度不变）`)
}

/** 清掉应用设置的 Redis 缓存（不重建库的重跑会读到旧的 4/60；只删这一个键，不 FLUSHDB） */
async function clearAppSettingCache(): Promise<void> {
  const redis = createClient({
    socket: { host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
    password: E2E_REDIS_PASS,
  })
  redis.on('error', () => {})
  try {
    await redis.connect()
    await redis.del(['WALNUT_CACHE_APP:SETTING', 'APP:SETTING'])
  }
  finally {
    await redis.quit().catch(() => {})
  }
}

async function main(): Promise<void> {
  assertE2eDatabase(E2E_PG_DB)
  assertE2ePgPort(E2E_PG_PORT)

  const password = `E2e-${randomBytes(12).toString('hex')}`
  writeServerMigrationEnv()
  writeSeedEnv()

  mkdirSync(AUTH_DIR, { recursive: true })
  mkdirSync(ARTIFACT_DIR, { recursive: true })

  const maintenance = new Client({
    host: E2E_PG_HOST,
    port: E2E_PG_PORT,
    user: E2E_PG_USER,
    password: E2E_PG_PASS,
    database: MAINTENANCE_DB,
  })
  await maintenance.connect()

  try {
    await acquireLock(maintenance)

    log(`DROP DATABASE IF EXISTS ${E2E_PG_DB} WITH (FORCE)`)
    await maintenance.query(`DROP DATABASE IF EXISTS "${E2E_PG_DB}" WITH (FORCE)`)
    log(`CREATE DATABASE ${E2E_PG_DB}`)
    await maintenance.query(`CREATE DATABASE "${E2E_PG_DB}"`)

    // 迁移：typeorm CLI 只读 env-local/.env.e2e（见 writeServerMigrationEnv）
    log('跑迁移（NODE_ENV=e2e → apps/server/env-local/.env.e2e）')
    runPnpm(['run', 'migration:run'], SERVER_ROOT, { ...process.env, NODE_ENV: 'e2e' })

    // seed：--env-file 指向整份拷贝（AUTH_OPAQUE_SECRET 必须与后端同源）
    log('播 seed + 建 admin 口令身份（db:seed:pg --admin admin）')
    runPnpm(
      ['exec', 'walnut-db-seed-pg', '--env-file', E2E_ENV_FILE, '--admin', 'admin', '--password', password],
      REPO_ROOT,
      { ...process.env },
    )

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
      await relaxCapThrottleForTests(db)
      // 运行时角色 walnut_app 的密码：迁移的 CREATE ROLE 带「开发引导密码」，而 stage
      // 启动会拒绝那个字面量（libs/config 的 L5 防呆）—— 在本库把它换成本栈固定值。
      // 角色是集群级的，但本栈的 PG 实例只服务 E2E，所以这里改的就是「本栈自己的角色」。
      await db.query(`ALTER ROLE ${E2E_PG_APP_USER} WITH LOGIN PASSWORD '${E2E_PG_APP_PASS}'`)
      log(`已重置 ${E2E_PG_APP_USER} 口令（stage 启动不接受迁移里的开发引导密码）`)
    }
    finally {
      await db.end()
    }

    writeFileSync(
      CREDENTIALS_FILE,
      `${JSON.stringify({ userName: 'admin', password, totpSecret: '' }, null, 2)}\n`,
      'utf8',
    )
    log(`已写 ${CREDENTIALS_FILE}（口令随机生成；TOTP secret 由 stack.setup 绑定后补上）`)
    await clearAppSettingCache()
    log('完成：库已重建、seed 已播、admin 已提升为 root、CAP 节流已放宽')
  }
  finally {
    // 释放锁 + 关连接（drop 之后重连的新库连接在下面单独建，与本连接无关）
    await maintenance.query('SELECT pg_advisory_unlock($1)', [E2E_PG_LOCK_KEY]).catch(() => {})
    await maintenance.end()
  }
}

main().catch((error) => {
  console.error('[e2e/prepare-db] 失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
