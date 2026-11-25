/**
 * 写本轮 E2E 栈信息到 `.e2e/stack.json`（gitignored）。
 *
 * 用途：排障时先看这一份 —— 本轮用的是哪个库 / 哪个端口 / 哪份产物 / 哪一轮 run id。
 * 全部来自 scripts/env.ts 的同一份常量，不手抄；凭据也在里面（本机测试栈），但目录 gitignored。
 *
 * **产物新鲜度**：`mtime` 读的是文件系统的真实修改时间（`statSync`），不是「写这份 JSON 的时刻」。
 * 它回答的是「这轮跑的是几分钟前刚构建的产物，还是上周的」。目录与两个入口文件各记一条 ——
 * 只记目录 mtime 时，`index.html` 被单独覆盖不留痕迹。
 *
 * 它刻意**不启动**任何东西：`scripts/run.ts` 在 prepare-db 之后调它，webServer 由 Playwright 起。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_DIST_DIR,
  ADMIN_INDEX_FILE,
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
  SERVER_DIST_DIR,
  SERVER_MAIN_FILE,
  STACK_INFO_FILE,
  WEB_ORIGIN,
} from './env.ts'

interface ArtifactInfo {
  path: string
  exists: boolean
  /** 真实 mtime（ISO 8601）；不存在时 null */
  mtime: string | null
}

function artifactInfo(target: string): ArtifactInfo {
  if (!existsSync(target)) {
    return { path: target, exists: false, mtime: null }
  }
  return { path: target, exists: true, mtime: statSync(target).mtime.toISOString() }
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()
  }
  catch {
    return 'unknown'
  }
}

/** 写 `.e2e/stack.json`（run.ts 调；也可 `node scripts/stack-info.ts` 单独跑） */
export function writeStackInfo(): void {
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
      adminDist: artifactInfo(ADMIN_DIST_DIR),
      adminIndex: artifactInfo(ADMIN_INDEX_FILE),
      serverDist: artifactInfo(SERVER_DIST_DIR),
      serverMain: artifactInfo(SERVER_MAIN_FILE),
    },
    credentialsFile: existsSync(CREDENTIALS_FILE) ? CREDENTIALS_FILE : null,
  }

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  writeFileSync(STACK_INFO_FILE, `${JSON.stringify(stack, null, 2)}\n`, 'utf8')

  console.log(`[e2e/stack-info] runId=${runId}`)
  console.log(`[e2e/stack-info] web=${WEB_ORIGIN}  api=${WEB_ORIGIN}/api  backend=${BACKEND_ORIGIN}`)
  console.log(`[e2e/stack-info] pg=${E2E_PG_HOST}:${E2E_PG_PORT}/${E2E_PG_DB}  redis=${E2E_REDIS_HOST}:${E2E_REDIS_PORT}`)
  console.log(`[e2e/stack-info] 产物 mtime：admin/index.html=${stack.artifacts.adminIndex.mtime ?? '缺失'}  server/main.js=${stack.artifacts.serverMain.mtime ?? '缺失'}`)
  console.log(`[e2e/stack-info] 已写 ${STACK_INFO_FILE}`)
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  writeStackInfo()
}
