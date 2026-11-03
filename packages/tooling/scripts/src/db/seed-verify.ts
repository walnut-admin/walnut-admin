/**
 * `db:seed:verify` —— **双库对拍**：旧 seed + 旧映射管线 与 新 seed，灌两个空库后逐表比。
 *
 * ## 它到底在证什么
 *
 * D5=B 把 `apps/server/db/seed/` 从「Mongo Extended JSON + 938 行运行时映射」换成「PG 行形态」。
 * 这件事的**唯一**验收判据是：同一份数据走两条路灌进空库后**逐表全等**。所以本脚本：
 *
 * 1. 从 git 取**基线**（旧 seed 文件 + 旧映射管线代码）到 `apps/server/.tmp/seed-verify/` ——
 *    旧管线已随本批删除，但 git 里有；这是「可复跑」且**不提交第二份数据快照**的唯一办法；
 * 2. 建两个空库（默认 `walnut_seed_a` / `walnut_seed_b`）并跑 migration（走 `pnpm migration:run`，
 *    与人工建库同一条路径；**不碰**现有库）；
 * 3. A 库：旧 seed + 旧管线播种；B 库：仓内 seed + 现管线播种；
 * 4. 逐表比**全部列**（`SELECT t::text`：jsonb 归一、timestamptz 文本一并比到），
 *    再各导出一次 `db:export:pg` 比**文件内容**（「导出可往返」的口径）；
 * 5. 任一表/任一文件不等 → 退出码 1 并打印首个差异。
 *
 * ## 什么时候该跑
 *
 * seed 形态、映射表（`seed-reshape.ts`）或播种器（`seed-pg.ts`）改了就手动跑一次。
 * **不进** prepush / CI：它要一个真实 PG 实例，且会 DROP 两个（本机开发才敢这么干）库名。
 *
 * ```bash
 * pnpm db:seed:verify                            # 对着 07dacfd6（批次 5-B 基线）对拍
 * pnpm db:seed:verify --baseline-ref HEAD~3      # 换基线
 * ```
 */
import type { PgTarget } from './pg-conn.ts'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { resolvePgTarget } from './pg-conn.ts'
import { SEED_DIR } from './seed.ts'

/** 批次 5-B 的基线：旧 seed + 旧 `seed-map` 管线最后所在的提交 */
export const DEFAULT_BASELINE_REF = '07dacfd6'

/** 临时工作目录（`apps/server/.tmp/` 已被 gitignore） */
const WORK_DIR = 'apps/server/.tmp/seed-verify'

export interface SeedVerifyOptions {
  baselineRef: string
  dbA: string
  dbB: string
}

export function parseSeedVerifyArgs(argv: readonly string[]): SeedVerifyOptions {
  const opts: SeedVerifyOptions = { baselineRef: DEFAULT_BASELINE_REF, dbA: 'walnut_seed_a', dbB: 'walnut_seed_b' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--baseline-ref':
        opts.baselineRef = next()
        break
      case '--db-a':
        opts.dbA = next()
        break
      case '--db-b':
        opts.dbB = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --baseline-ref / --db-a / --db-b）`)
    }
  }
  if (opts.dbA === opts.dbB)
    throw new PreconditionError('--db-a 与 --db-b 不能是同一个库（会互相覆盖，对拍失去意义）')
  return opts
}

/** 跑一条 shell 命令（Windows 上 `pnpm` 是 .cmd、`tar` 是外部命令 —— 必须经 shell 解析） */
export function runShell(command: string, options: { cwd: string, env?: Record<string, string> }): string {
  const result = spawnSync(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new ViolationError(
      `命令失败（exit=${String(result.status)}）：${command}\n--- stdout ---\n${result.stdout ?? ''}\n--- stderr ---\n${result.stderr ?? ''}`,
    )
  }
  return result.stdout ?? ''
}

/**
 * 从 git 取基线到临时目录：**旧 seed 数据 + 旧映射管线代码**。
 *
 * 只取数据不够 —— 旧管线（`seed-map.ts`）已删除，得连同代码一起取出来才复现得了「旧路」。
 * 解包到 `apps/server/.tmp/` 下还有个好副作用：那里的模块解析能走到 `apps/server/node_modules`
 * （`pg` / `@serenity-kit/opaque` 都在），基线 CLI 可以直接 `node` 跑，不必再装一遍依赖。
 */
export function extractBaseline(repoRoot: string, ref: string): { dir: string, seedDir: string, bin: string } {
  const dir = join(repoRoot, WORK_DIR, ref)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const tarPath = join(dir, 'baseline.tar')
  runShell(`git archive --format=tar -o "${tarPath}" ${ref} packages/tooling/scripts/src packages/tooling/scripts/bin ${SEED_DIR}`, { cwd: repoRoot })
  runShell(`tar -xf "${tarPath}" -C "${dir}"`, { cwd: repoRoot })

  return {
    dir,
    seedDir: join(dir, SEED_DIR),
    bin: join(dir, 'packages/tooling/scripts/bin/db-seed-pg.ts'),
  }
}

/** 建库：先 DROP（WITH FORCE 杀掉残留连接）再 CREATE，避免上一轮残留 */
export async function recreateDatabase(target: PgTarget, database: string): Promise<void> {
  const admin = new Client({ host: target.host, port: target.port, user: target.user, password: target.password, database: 'postgres' })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${database}"`)
  }
  finally {
    await admin.end()
  }
}

/**
 * 跑 migration：`NODE_ENV` 指到一个临时 env 文件（内容是从开发 env 复制的，只换库名）——
 * `data-source.cli.ts` 按 `env-local/.env.${NODE_ENV}` 找文件，这是它唯一的入口。
 */
export function runMigrations(repoRoot: string, database: string): void {
  const devEnvPath = join(repoRoot, 'apps/server/env-local/.env.development')
  const devEnv = readFileSync(devEnvPath, 'utf8')
  if (!/^DATABASE_PG_NAME=/m.test(devEnv))
    throw new PreconditionError(`开发 env 里没有 DATABASE_PG_NAME（${devEnvPath}）`)
  const envName = `seed-verify-${database}`
  const tempEnvPath = join(repoRoot, `apps/server/env-local/.env.${envName}`)
  writeFileSync(tempEnvPath, devEnv.replace(/^DATABASE_PG_NAME=.*$/m, `DATABASE_PG_NAME=${database}`))
  try {
    runShell('pnpm migration:run', { cwd: join(repoRoot, 'apps/server'), env: { NODE_ENV: envName } })
  }
  finally {
    rmSync(tempEnvPath, { force: true })
  }
}

/** 用一个具体的 seed 管线（bin 路径 + seed 目录）播一个库 */
export function seedDatabase(repoRoot: string, bin: string, seedDir: string, database: string): string {
  return runShell(
    `node "${bin}" --skip-app-keys --pg-db ${database} --seed-dir "${seedDir}" --env-file "${join(repoRoot, 'apps/server/env-local/.env.development')}"`,
    { cwd: repoRoot },
  )
}

/** 导出一次（拿现管线 `db:export:pg`，两份都用同一条命令，格式才可比） */
export function exportSnapshot(repoRoot: string, database: string, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true })
  runShell(
    `node "${join(repoRoot, 'packages/tooling/scripts/bin/db-export-pg.ts')}" --pg-db ${database} --out "${outDir}"`,
    { cwd: repoRoot },
  )
}

/** 一个库里所有表的完整行文本（`t::text` 把 jsonb / timestamptz 归一成 PG 的规范文本） */
export async function dumpTables(target: PgTarget, database: string, tables: readonly string[]): Promise<Map<string, string[]>> {
  const client = new Client({ host: target.host, port: target.port, user: target.user, password: target.password, database })
  await client.connect()
  try {
    const result = new Map<string, string[]>()
    for (const table of tables) {
      const rows = await client.query<{ r: string }>(`SELECT t::text AS r FROM ${table} t ORDER BY t::text`)
      result.set(table, rows.rows.map(row => row.r))
    }
    return result
  }
  finally {
    await client.end()
  }
}

export interface TableDiff {
  table: string
  rowsA: number
  rowsB: number
  /** 首个差异的可读描述（相等时为 null） */
  firstDifference: string | null
}

/** 逐表比对两组行文本（顺序无关：两侧都已按行文本排序） */
export function diffTableRows(table: string, rowsA: readonly string[], rowsB: readonly string[]): TableDiff {
  const setB = new Set(rowsB)
  const setA = new Set(rowsA)
  const onlyA = rowsA.filter(row => !setB.has(row))
  const onlyB = rowsB.filter(row => !setA.has(row))
  if (onlyA.length === 0 && onlyB.length === 0)
    return { table, rowsA: rowsA.length, rowsB: rowsB.length, firstDifference: null }
  const detail = [
    `A 独有 ${onlyA.length} 行 / B 独有 ${onlyB.length} 行`,
    onlyA[0] === undefined ? '' : `  A: ${onlyA[0].slice(0, 400)}`,
    onlyB[0] === undefined ? '' : `  B: ${onlyB[0].slice(0, 400)}`,
  ].filter(Boolean).join('\n')
  return { table, rowsA: rowsA.length, rowsB: rowsB.length, firstDifference: detail }
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseSeedVerifyArgs(process.argv.slice(2))
  const { target } = resolvePgTarget(repoRoot)
  const tables = readdirSync(join(repoRoot, SEED_DIR)).filter(file => file.endsWith('.json')).map(file => file.replace(/\.json$/, '')).sort()

  out(`双库对拍：基线 ${opts.baselineRef}（旧 seed + 旧管线） vs 仓内 seed（行形态 + 现管线）`)
  out(`  库：${opts.dbA} / ${opts.dbB}（都会先 DROP，**不碰**现有库）`)
  out(`  比对面：${tables.length} 个表（全部列）+ 各导出一次 db:export:pg 的文件内容`)

  out(`[1/5] 从 git 取基线到 ${WORK_DIR}/${opts.baselineRef}`)
  const baseline = extractBaseline(repoRoot, opts.baselineRef)

  out(`[2/5] 建两个空库并跑 migration`)
  for (const database of [opts.dbA, opts.dbB]) {
    await recreateDatabase(target, database)
    runMigrations(repoRoot, database)
  }

  out(`[3/5] 播种：A = 基线管线 + 基线 seed；B = 现管线 + 仓内 seed`)
  const seededA = seedDatabase(repoRoot, baseline.bin, baseline.seedDir, opts.dbA)
  const seededB = seedDatabase(repoRoot, join(repoRoot, 'packages/tooling/scripts/bin/db-seed-pg.ts'), join(repoRoot, SEED_DIR), opts.dbB)
  out(`  A: ${seededA.trim().split('\n').filter(Boolean).length} 行输出；B: ${seededB.trim().split('\n').filter(Boolean).length} 行输出`)

  out(`[4/5] 逐表比全部列`)
  const rowsA = await dumpTables(target, opts.dbA, tables)
  const rowsB = await dumpTables(target, opts.dbB, tables)
  const diffs = tables.map(table => diffTableRows(table, rowsA.get(table) ?? [], rowsB.get(table) ?? []))
  for (const diff of diffs) {
    const mark = diff.firstDifference === null ? '✅' : '✖'
    out(`  ${mark} ${diff.table.padEnd(16)} A=${String(diff.rowsA).padStart(6)} B=${String(diff.rowsB).padStart(6)}`)
    if (diff.firstDifference !== null)
      out(`     ${diff.firstDifference.replaceAll('\n', '\n     ')}`)
  }

  out(`[5/5] 各导出一次 db:export:pg 并比文件内容`)
  const outDir = join(repoRoot, WORK_DIR, opts.baselineRef)
  exportSnapshot(repoRoot, opts.dbA, join(outDir, 'export-a'))
  exportSnapshot(repoRoot, opts.dbB, join(outDir, 'export-b'))
  const exportFiles = readdirSync(join(outDir, 'export-a')).filter(file => file.endsWith('.json')).sort()
  const exportDiffs: string[] = []
  for (const file of exportFiles) {
    const a = readFileSync(join(outDir, 'export-a', file), 'utf8')
    const b = readFileSync(join(outDir, 'export-b', file), 'utf8')
    const same = a === b
    if (!same)
      exportDiffs.push(file)
    out(`  ${same ? '✅' : '✖'} ${file.padEnd(22)} ${same ? `${a.length} 字符` : `A=${a.length} / B=${b.length} 字符`}`)
  }

  const tableDiffs = diffs.filter(diff => diff.firstDifference !== null)
  if (tableDiffs.length > 0 || exportDiffs.length > 0) {
    throw new ViolationError(
      `对拍不一致：表 ${tableDiffs.map(d => d.table).join(', ') || '（无）'}；导出文件 ${exportDiffs.join(', ') || '（无）'}`,
    )
  }

  line('ok', `对拍全等：${tables.length} 个表（全部列）+ ${exportFiles.length} 个导出文件，两库逐行逐字节相同`)
}
