import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
/**
 * 写本轮 E2E 栈信息到 `.e2e/stack.json`（gitignored）。
 *
 * 用途：排障时先看这一份 —— 本轮用的是哪个库 / 哪个端口 / 哪份产物 / 哪一轮 run id。
 * 全部来自 scripts/env.ts 的同一份常量，不手抄；凭据也在里面（本机测试栈），但目录 gitignored。
 *
 * 它刻意**不启动**任何东西：`e2e` 脚本在 prepare-db 之后调它，webServer 由 Playwright 起。
 */
import process from 'node:process'
import {
  ADMIN_DIST_DIR,
  ARTIFACT_DIR,
  BACKEND_ORIGIN,
  CREDENTIALS_FILE,
  DEVICE_COOKIE_NAME,
  E2E_PG_APP_USER,
  E2E_PG_DB,
  E2E_PG_HOST,
  E2E_PG_PORT,
  E2E_PG_USER,
  E2E_REDIS_HOST,
  E2E_REDIS_PORT,
  REPO_ROOT,
  SERVER_ROOT,
  STACK_INFO_FILE,
  WEB_ORIGIN,
} from './env.ts'

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return 'unknown'
  }
}

function dirInfo(dir: string): { path: string, exists: boolean, mtime: string | null } {
  if (!existsSync(dir))
    return { path: dir, exists: false, mtime: null }
  return { path: dir, exists: true, mtime: new Date().toISOString() }
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`

const stack = {
  runId,
  startedAt: new Date().toISOString(),
  commit: gitCommit(),
  urls: {
    web: WEB_ORIGIN,
    api: `${WEB_ORIGIN}/api`,
    backend: BACKEND_ORIGIN,
    backendHealth: `${BACKEND_ORIGIN}/health/ready`,
  },
  pg: {
    host: E2E_PG_HOST,
    port: E2E_PG_PORT,
    database: E2E_PG_DB,
    adminUser: E2E_PG_USER,
    appUser: E2E_PG_APP_USER,
  },
  redis: { host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
  cookies: { device: DEVICE_COOKIE_NAME },
  artifacts: {
    adminDist: dirInfo(ADMIN_DIST_DIR),
    serverDist: dirInfo(path.join(SERVER_ROOT, 'dist-stage')),
  },
  credentialsFile: existsSync(CREDENTIALS_FILE) ? CREDENTIALS_FILE : null,
}

mkdirSync(ARTIFACT_DIR, { recursive: true })
writeFileSync(STACK_INFO_FILE, `${JSON.stringify(stack, null, 2)}\n`, 'utf8')

console.log(`[e2e/stack-info] runId=${runId}`)
console.log(`[e2e/stack-info] web=${WEB_ORIGIN}  api=${WEB_ORIGIN}/api  backend=${BACKEND_ORIGIN}`)
console.log(`[e2e/stack-info] pg=${E2E_PG_HOST}:${E2E_PG_PORT}/${E2E_PG_DB}  redis=${E2E_REDIS_HOST}:${E2E_REDIS_PORT}`)
console.log(`[e2e/stack-info] 已写 ${STACK_INFO_FILE}`)
