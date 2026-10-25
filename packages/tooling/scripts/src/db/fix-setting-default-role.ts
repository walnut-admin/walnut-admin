/**
 * `db:fix-default-role` —— 把 `app_setting` 里 `app.default.role` 的值从 role 的
 * ObjectId hex 重写为它的 uuid v5（phase3-plan §5 残留窗口 2，B7 切换前的硬前置）。
 *
 * ## 为什么需要
 *
 * `user.crud` / `user.shared`（B7 迁移）目前从该 setting 读默认角色并 `new Types.ObjectId(value)`；
 * ETL 之后 PG 侧 role 主键是 v5 派生 uuid，setting 里若还是 hex，B7 一切换创建用户即炸。
 * 本脚本在 B5 落地、B7 验收前置检查运行。
 *
 * ## 幂等
 *
 * 值已是规范 uuid → no-op（重复跑安全）；值是 24 位 hex → 校验其确为 Mongo `sys_role`
 * 存量角色后重写为 v5（namespace 与 ETL 同源，见 `uuid5.ts`）；两者都不是 → 报错停下，
 * 不猜不改。
 *
 * ## 连接口径（与后端 / seed 同源）
 *
 * - PG：env 文件（`apps/server/env-local/.env.${NODE_ENV}`，可用 `--env-file` 覆盖）里的
 *   `DATABASE_PG_*` —— 与 `apps/api/src/database/data-source.cli.ts` 同一组变量、同一解析模式；
 * - Mongo：同文件的 `DATABASE_*`（副本集），与 `seed.ts` 共用 `buildMongoUri`；
 * - `--pg-db` / `--db` 可把目标指到别的库（集成测试就是靠它指向 `walnut-admin-integration`）。
 */
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { buildMongoUri, parseEnvFile, resolveEnvFile } from './seed.ts'
import { deriveUuidFromObjectId, isObjectIdHex, UUID_RE } from './uuid5.ts'

/** 目标 setting 键（cache.appSettings 的 functionalRole.defaultRole 数据源） */
export const DEFAULT_ROLE_SETTING_KEY = 'app.default.role'

export interface FixDefaultRoleOptions {
  envFile: string
  /** Mongo 目标库（默认取 env 的 DATABASE_NAME / uri 路径） */
  dbName?: string
  /** PG 目标库（默认取 env 的 DATABASE_PG_NAME） */
  pgDbName?: string
  uri?: string
  key: string
  dryRun: boolean
}

/** 解析 argv：未知参数直接报错（静默忽略的代价是"以为订正了、其实没订"） */
export function parseFixArgs(argv: readonly string[]): FixDefaultRoleOptions {
  const opts: FixDefaultRoleOptions = { envFile: '', key: DEFAULT_ROLE_SETTING_KEY, dryRun: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--key':
        opts.key = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      case '--db':
        opts.dbName = next()
        break
      case '--pg-db':
        opts.pgDbName = next()
        break
      case '--uri':
        opts.uri = next()
        break
      case '--dry-run':
        opts.dryRun = true
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --key / --env-file / --db / --pg-db / --uri / --dry-run）`)
    }
  }
  return opts
}

/** 订正动作计划（纯函数，单测盯语义）：幂等边界全在这里 */
export interface FixPlan {
  action: 'noop-already-uuid' | 'rewrite'
  currentValue: string
  nextValue?: string
}

export function buildDefaultRoleFixPlan(settingValue: string, validRoleHexes: ReadonlySet<string>): FixPlan {
  if (UUID_RE.test(settingValue)) {
    return { action: 'noop-already-uuid', currentValue: settingValue }
  }

  if (!isObjectIdHex(settingValue)) {
    throw new ViolationError(
      `setting 值既不是规范 uuid 也不是 24 位 ObjectId hex（${settingValue}）—— 数据形态未知，拒绝改写`,
    )
  }

  if (!validRoleHexes.has(settingValue)) {
    throw new PreconditionError(
      `setting 值 ${settingValue} 在 Mongo sys_role 的存量 _id 里找不到 —— 先确认角色还在（或改回正确 hex），不盲改`,
    )
  }

  return { action: 'rewrite', currentValue: settingValue, nextValue: deriveUuidFromObjectId(settingValue) }
}

/**
 * 订正主体（可测试注入：main 只做 env/连接装配）。返回实际发生的动作描述；
 * setting 行不存在时同样视为 no-op（seed 之前不会出现该键，订正不制造行）。
 */
export async function fixDefaultRoleSetting(
  pg: { host: string, port: number, user: string, password: string, database: string },
  mongo: { uri: string, dbName: string },
  options: { key: string, dryRun: boolean },
): Promise<{ action: FixPlan['action'] | 'noop-missing-setting', currentValue?: string, nextValue?: string }> {
  const pgClient = new Client(pg)
  await pgClient.connect()

  const mongoClient = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 8000 })
  await mongoClient.connect()

  try {
    // hex 源：Mongo sys_role 存量 _id（ETL 派生的输入本体）
    const roleHexes = new Set<string>()
    const roles = await mongoClient.db(mongo.dbName).collection('sys_role').find({}, { projection: { _id: 1 } }).toArray()
    for (const role of roles) {
      const hex = String(role._id)
      if (isObjectIdHex(hex)) {
        roleHexes.add(hex)
      }
    }

    const found = await pgClient.query<{ setting_value: string }>(
      'SELECT setting_value FROM app_setting WHERE setting_key = $1',
      [options.key],
    )

    const row = found.rows[0]
    if (row === undefined) {
      return { action: 'noop-missing-setting' }
    }

    const plan = buildDefaultRoleFixPlan(row.setting_value, roleHexes)

    if (plan.action === 'noop-already-uuid') {
      return { action: plan.action, currentValue: plan.currentValue }
    }

    if (!options.dryRun) {
      await pgClient.query(
        'UPDATE app_setting SET setting_value = $1, updated_at = now() WHERE setting_key = $2',
        [plan.nextValue, options.key],
      )
    }

    return { action: plan.action, currentValue: plan.currentValue, nextValue: plan.nextValue }
  }
  finally {
    await Promise.all([pgClient.end(), mongoClient.close()])
  }
}

/** 命令行主体：解析 env、装配两个连接、执行、打汇总 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseFixArgs(process.argv.slice(2))

  const envFile = resolveEnvFile(repoRoot, opts.envFile === '' ? undefined : opts.envFile)
  if (!existsSync(envFile)) {
    throw new PreconditionError(`找不到 env 文件 ${envFile} —— 先跑 \`pnpm setup-env\`，或用 --env-file 指定`)
  }
  const env = parseEnvFile(readFileSync(envFile, 'utf8'))

  const pgHost = env.DATABASE_PG_HOST
  const pgPort = Number.parseInt(env.DATABASE_PG_PORT)
  const pgUser = env.DATABASE_PG_USER
  const pgPass = env.DATABASE_PG_PASS
  if (!pgHost || Number.isNaN(pgPort) || !pgUser) {
    throw new PreconditionError(`env 文件缺 DATABASE_PG_* 变量（${envFile}）—— 与 data-source.cli 同源的一组`)
  }

  const mongoUri = opts.uri ?? buildMongoUri(env, opts.dbName)
  const mongoDbName = opts.dbName ?? new URL(mongoUri).pathname.replace(/^\//, '')
  if (mongoDbName === '') {
    throw new PreconditionError('解析不出 Mongo 库名 —— 用 --db 明确指定')
  }

  const pgDbName = opts.pgDbName ?? env.DATABASE_PG_NAME
  if (!pgDbName) {
    throw new PreconditionError('解析不出 PG 库名 —— 用 --pg-db 明确指定')
  }

  out(`目标 PG 库：${pgDbName}；Mongo 库：${mongoDbName}${opts.dryRun ? '（dry-run，不写入）' : ''}`)

  const result = await fixDefaultRoleSetting(
    { host: pgHost, port: pgPort, user: pgUser, password: pgPass, database: pgDbName },
    { uri: mongoUri, dbName: mongoDbName },
    { key: opts.key, dryRun: opts.dryRun },
  )

  switch (result.action) {
    case 'noop-missing-setting':
      line('ok', `app_setting 里没有 ${opts.key} —— 无需订正`)
      break
    case 'noop-already-uuid':
      line('ok', `值已是 uuid（${result.currentValue}）—— 幂等跳过`)
      break
    case 'rewrite':
      out(`  ${opts.key}: ${result.currentValue} → ${result.nextValue}`)
      line('ok', opts.dryRun ? 'dry-run 完成（未写入）' : '订正完成（hex → uuid v5）')
      break
  }
}
