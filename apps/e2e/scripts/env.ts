/**
 * 全链路 E2E 的**唯一环境真源**：端口 / URL / 库名 / 凭据 / cookie 名派生 / 安全闸。
 *
 * 为什么要集中：prepare-db（重建库）、static-server（反代目标）、stack-info（写栈信息）、
 * playwright.config（webServer / baseURL）与 spec 里的 PG / Redis 断言都读这几个值。
 * 任何一处手抄都会漂移，而漂移的症状是「连到了 dev 库」或「代理指到了 dev 后端」——
 * 两种都是**不可接受**的事故（本机同时跑着 dev 栈）。
 *
 * 安全闸（{@link assertE2eDatabase}）把这件事变成机械判据：任何脚本在 DROP / CREATE /
 * 清 Redis 之前都必须先过这道闸；库名不是 walnut_e2e 或端口不是 5433 一律拒跑。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** `apps/e2e` 的绝对路径（本文件在 scripts/ 下） */
export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 仓库根（D:/walnut-admin/walnut-admin） */
export const REPO_ROOT = path.resolve(E2E_ROOT, '../..')
/** 后端包根 —— 后端的 env 与 dist-stage 都以它为 cwd */
export const SERVER_ROOT = path.join(REPO_ROOT, 'apps/server')
/** 前端 stage 产物目录（static-server 伺服的根） */
export const ADMIN_DIST_DIR = path.join(REPO_ROOT, 'apps/admin/dist-staging')

/** 运行态目录：凭据（gitignored）与栈信息 */
export const AUTH_DIR = path.join(E2E_ROOT, '.auth')
export const ARTIFACT_DIR = path.join(E2E_ROOT, '.e2e')
/** prepare-db 写给 seed 的 env 文件（= .env.stage 的副本 + 独立库覆盖） */
export const E2E_ENV_FILE = path.join(ARTIFACT_DIR, 'e2e.env')
/** prepare-db 写给 typeorm CLI 的 env 文件（apps/server/env-local/.env.e2e，gitignored） */
export const SERVER_E2E_ENV_FILE = path.join(SERVER_ROOT, 'env-local/.env.e2e')
/** 账号凭据 + TOTP secret（stack.setup 写入；所有 spec 只读） */
export const CREDENTIALS_FILE = path.join(AUTH_DIR, 'credentials.json')
/** auth.setup 落盘的登录态（storageState；indexedDB 能不能带过来由 Phase 0 gate 2 实测决定） */
export const STORAGE_STATE_FILE = path.join(AUTH_DIR, 'admin.json')
/** 本轮栈信息 */
export const STACK_INFO_FILE = path.join(ARTIFACT_DIR, 'stack.json')

// ─── 独立栈（绝不指向 dev 的 5432 / 6379 / 3000 / 3100）──────────────────────────
export const E2E_PG_HOST = '127.0.0.1'
/** 独立 PG 端口（compose 里 5433:5432） */
export const E2E_PG_PORT = 5433
/** 管理通道角色（迁移 / seed / 断言；superuser 语义） */
export const E2E_PG_USER = 'walnut'
export const E2E_PG_PASS = 'e2e_dev_only'
/** 独立库名 —— 安全闸的唯一判据 */
export const E2E_PG_DB = 'walnut_e2e'
/** 运行时角色（RLS：迁移会 CREATE ROLE ... PASSWORD；prepare-db 之后改成下面这个值） */
export const E2E_PG_APP_USER = 'walnut_app'
export const E2E_PG_APP_PASS = 'walnut_app_e2e_only'

export const E2E_REDIS_HOST = '127.0.0.1'
/** 独立 Redis 端口（compose 里 6380:6379） */
export const E2E_REDIS_PORT = 6380
export const E2E_REDIS_PASS = 'e2e_redis_only'

/** 后端（dist-stage + NODE_ENV=stage）；刻意避开 dev 的 3000 */
export const BACKEND_PORT = 3001
export const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`
/** 后端自己的 socket.io 监听端口（见 .env.stage 的 SOCKET_SERVER_PORT；E2E 也换一个） */
export const SOCKET_PORT = 3002
/** 测试静态代理（伺服 dist-staging + /api /socket 反代） */
export const WEB_PORT = 4173
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`

/** 与后端 .env.stage 同源的 API 前缀 / 版本（`/w/v1`） */
export const API_PREFIX = 'w'
export const API_VERSION = '1'
/** 浏览器侧 API 根（dist-staging 的 VITE_PROXY 把 /api 指到这里，代理再改写到 /w/v1） */
export const WEB_API_BASE = `${WEB_ORIGIN}/api`
/** 后端 API 根（代理目标） */
export const BACKEND_API_BASE = `${BACKEND_ORIGIN}/${API_PREFIX}/v${API_VERSION}`

/**
 * stage 形态的 cookie 名（`libs/const/src/app/cookie.ts` 的 getSafeCookieKey：dev 有 __Host-、
 * prod 有 __Secure-，**stage 无前缀**）。E2E 后端固定 NODE_ENV=stage ⇒ 就是基名。
 */
export const DEVICE_COOKIE_NAME = 'DEVICE_ID'
export const CAPJS_COOKIE_NAME = 'CAPJS_TOKEN'
export const SIGN_TICKET_COOKIE_NAME = 'SIGN_TICKET'
export const RT_JTI_COOKIE_NAME = 'RT_JTI'

/**
 * 真实 Chrome UA 的**唯一真源**在 lib/protocol/sign.ts（`SIGN_USER_AGENT`）——
 * 协议客户端的签名原文与 Playwright context 的 userAgent 必须逐字一致，
 * 所以这里不再抄第二份，只在 playwright.config.ts 里 import 那个常量。
 */

/**
 * 安全闸：目标库必须**逐字**是 walnut_e2e。
 *
 * 凡是要 DROP / CREATE / DELETE / Redis 清键的脚本，第一步都调它 —— 名字写错、env 读串、
 * 有人把 DATABASE_PG_NAME 复制成 walnut_pg，都在这里当场抛，而不是在 drop 之后。
 */
export function assertE2eDatabase(database: string): void {
  if (database !== E2E_PG_DB) {
    throw new Error(
      `[e2e/safety] 拒绝对库 \`${database}\` 执行破坏性操作：E2E 只允许 \`${E2E_PG_DB}\`。`
      + '（dev 的 walnut_pg 与本栈共用一套脚本的话，任何一次误跑都会清掉开发数据）',
    )
  }
}

/** 安全闸：PG 端口必须是独立栈的 5433（防「连到 dev 的 5432 再 drop」） */
export function assertE2ePgPort(port: number): void {
  if (port !== E2E_PG_PORT) {
    throw new Error(`[e2e/safety] 拒绝在 PG 端口 ${port} 上跑 E2E：只允许 ${E2E_PG_PORT}（dev 是 5432）`)
  }
}

/** 安全闸：Redis 端口必须是 6380（E2E 会删自己设备缓存键；连错库会清掉 dev 缓存） */
export function assertE2eRedisPort(port: number): void {
  if (port !== E2E_REDIS_PORT) {
    throw new Error(`[e2e/safety] 拒绝在 Redis 端口 ${port} 上跑 E2E：只允许 ${E2E_REDIS_PORT}（dev 是 6379）`)
  }
}

/** 简单 env 文件解析（与 tooling/scripts/src/db/seed.ts 的 parseEnvFile 同口径） */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.trim()
    if (lineText === '' || lineText.startsWith('#'))
      continue
    const eq = lineText.indexOf('=')
    if (eq <= 0)
      continue
    const key = lineText.slice(0, eq).trim()
    let value = lineText.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
      value = value.slice(1, -1)
    env[key] = value
  }
  return env
}

/** 后端 stage env 文件（`apps/server/env-local/.env.stage`）—— OPAQUE / cookie 密钥的唯一来源 */
export const SERVER_STAGE_ENV_FILE = path.join(SERVER_ROOT, 'env-local/.env.stage')

/** 读后端 stage env（缺文件时给出可操作的报错：先跑 `pnpm setup-env`） */
export function readServerStageEnv(): Record<string, string> {
  if (!existsSync(SERVER_STAGE_ENV_FILE)) {
    throw new Error(
      `[e2e] 找不到 ${SERVER_STAGE_ENV_FILE} —— 先跑 \`pnpm setup-env\` 解密 env-local/（需要根 .env.keys）`,
    )
  }
  return parseEnvFile(readFileSync(SERVER_STAGE_ENV_FILE, 'utf8'))
}

/**
 * 注入给后端进程的 env 覆盖：**只覆盖连接目标与端口**，OPAQUE / cookie / JWT 等根密钥
 * 仍取 .env.stage 的那一份（前端构建内嵌的 OPAQUE 公钥与它同源，换一份就登录不上）。
 *
 * 为什么靠进程 env 而不是再写一份 stage env：`@nestjs/config` 的 env 文件加载**不覆盖**
 * 已存在的 process.env —— 这正是「同一份 .env.stage + 不同连接目标」的干净切法。
 */
export function backendEnvOverrides(): Record<string, string> {
  return {
    DATABASE_PG_HOST: E2E_PG_HOST,
    DATABASE_PG_PORT: String(E2E_PG_PORT),
    DATABASE_PG_USER: E2E_PG_USER,
    DATABASE_PG_PASS: E2E_PG_PASS,
    DATABASE_PG_NAME: E2E_PG_DB,
    DATABASE_PG_APP_USER: E2E_PG_APP_USER,
    DATABASE_PG_APP_PASS: E2E_PG_APP_PASS,
    APP_REDIS_HOST: E2E_REDIS_HOST,
    APP_REDIS_PORT: String(E2E_REDIS_PORT),
    APP_REDIS_PASS: E2E_REDIS_PASS,
    APP_PORT: String(BACKEND_PORT),
    SOCKET_SERVER_PORT: String(SOCKET_PORT),
    // 限流放宽：ThrottlerGuard 按 req.realIp 计数（内存态），E2E 所有流量都来自 127.0.0.1
    // 同一个桶；整套用例分钟级几十次登录 + 每页几十个请求，120/60s 的缺省会在一两分钟后
    // 把后续用例全变成 42900（/not-allowed?type=tooManyRequests）。这是**测试栈**的配置，
    // 不是产品口径 —— 风控的 RATE 因子另有自己的阈值（risk.config 的 rate.ip1m 等），不受这里影响。
    APP_THROTTLE_TTL: '60',
    APP_THROTTLE_LIMIT: '100000',
  }
}

export interface StackCredentials {
  userName: string
  password: string
  /** TOTP secret（bind 时由服务端返回；auth.setup / spec 用它现算 6 位码） */
  totpSecret: string
}

/** 读 stack.setup 写下的账号凭据（不存在时抛，提示先跑 setup 项目） */
export function readCredentials(): StackCredentials {
  if (!existsSync(CREDENTIALS_FILE)) {
    throw new Error(
      `[e2e] 找不到 ${CREDENTIALS_FILE} —— 先用 \`pnpm --filter @walnut/e2e e2e\` 跑一遍（stack-setup 会绑定 TOTP 并写入）`,
    )
  }
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as StackCredentials
}
