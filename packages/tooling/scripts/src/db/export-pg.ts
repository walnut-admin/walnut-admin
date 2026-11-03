/**
 * `db:export:pg` —— 从 **PostgreSQL** 反向导出「历史导出形态」的 Extended JSON（`_id` 是 uuid 本体）。
 *
 * ## 两条通道，别混
 *
 * | 通道 | 产物 | 谁消费 |
 * |------|------|--------|
 * | 本命令（`--out` 到临时目录） | Extended JSON 快照（`$date` 包装、驼峰键） | `db:seed:reshape` 拍平成仓内真源；人工 review / 跨生态搬运 |
 * | `db:seed:reshape --to apps/server/db/seed` | **PG 行形态**（`{ id, created_at, … }` + junction 独立文件） | `db:seed:pg`；仓内真源 |
 *
 * 所以本命令**不再**默认写进 `apps/server/db/seed/`：那里是真源（行形态），写快照进去会把真源
 * 打回 Extended JSON（`lint:seed` 会判红）。命令里对「`--out` 指向 seed 目录」做了显式拦截。
 *
 * 再生成真源的完整两步（不手写任何一行）：
 *
 * ```bash
 * pnpm db:export:pg --out apps/server/.tmp/pg-export      # 库 → 快照
 * pnpm db:seed:reshape --from apps/server/.tmp/pg-export  # 快照 → 行形态（默认写仓内 seed）
 * ```
 *
 * ## 形态约束（与 seed 真源共用）
 *
 * 1. 导出哪些表 = 仓里 seed 目录有哪些文件（`--only` 可收窄）；`shared_area` 走 `--areas` 另存；
 * 2. 文档按 `_id` 排序（uuid 字典序），diff 可审；
 * 3. 裁剪策略（`policy.ts`）照套 —— 导出形态与仓内 seed 的口径保持一族；
 * 4. `--anonymize` 脱敏导出：在反向映射后的文档上跑 `anonymize.ts`（按键名判定，与库无关），
 *    给「线上 PG → 开发」通道用。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { PreconditionError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { anonymizeDocs } from './anonymize.ts'
import { stringifyCollectionFile } from './ejson.ts'
import { resolvePgTarget } from './pg-conn.ts'
import { applyPolicy } from './policy.ts'
import { JUNCTION_TABLES } from './seed-reshape.ts'
import { listSeedCollections, resolvePath, SEED_DIR } from './seed.ts'

/** 默认输出目录：导出快照是**中间物**（消费方是 `db:seed:reshape`），不落在真源目录 */
export const DEFAULT_EXPORT_OUT = 'apps/server/.tmp/pg-export'

export interface ExportPgOptions {
  seedDir: string
  envFile: string
  pgDbName?: string
  only?: string[]
  outDir: string
  areas?: string
  anonymize: boolean
}

export function parseExportPgArgs(argv: readonly string[]): ExportPgOptions {
  // 默认**不**写进 seed 目录：那里现在是 PG 行形态真源（快照写进去会把真源打回 Extended JSON）
  const opts: ExportPgOptions = { seedDir: SEED_DIR, envFile: '', outDir: DEFAULT_EXPORT_OUT, anonymize: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--out':
        opts.outDir = next()
        break
      case '--areas':
        opts.areas = next()
        break
      case '--anonymize':
        opts.anonymize = true
        break
      case '--only':
        opts.only = next().split(',').map(s => s.trim()).filter(Boolean)
        break
      case '--pg-db':
        opts.pgDbName = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      case '--seed-dir':
        opts.seedDir = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --out / --areas / --anonymize / --only / --pg-db / --env-file / --seed-dir）`)
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// 反向映射：PG 行 → Mongo 形态文档（字段名回 schema 形态；uuid 原样写）
// 只覆盖 seed 目录那 8 个集合 + shared_area（导出面 = 仓内 seed 面）。
// ---------------------------------------------------------------------------

/** 逆向映射注册表：集合名 → (行 → Mongo 形态文档)；junction 由调用方预取注入 */
export type PgRow = Record<string, unknown>
export type ReverseMapper = (row: PgRow, extras: { junctionRows: readonly PgRow[] }) => Record<string, unknown>

function timestampsOf(row: PgRow): Record<string, unknown> {
  return { createdAt: row.created_at, updatedAt: row.updated_at }
}

const REVERSE_MAPPERS: Record<string, ReverseMapper> = {
  sys_user: (row, { junctionRows }) => ({
    _id: row.id,
    userName: row.user_name,
    nickName: row.nick_name,
    age: row.age,
    gender: row.gender,
    avatar: row.avatar,
    description: row.description,
    status: row.status,
    roles: junctionRows.filter(j => j.user_id === row.id).map(j => j.role_id),
    roleMode: row.role_mode,
    currentRole: row.current_role_id,
    mfaSetup: row.mfa_setup,
    ...timestampsOf(row),
  }),
  sys_role: (row, { junctionRows }) => ({
    _id: row.id,
    roleName: row.role_name,
    description: row.description,
    order: row.sort_order,
    menus: junctionRows.filter(j => j.role_id === row.id).map(j => j.menu_id),
    status: row.status,
    dataScope: row.data_scope,
    ...timestampsOf(row),
  }),
  sys_menu: (row) => {
    const meta: Record<string, unknown> = {
      order: row.sort_order,
      ternal: row.ternal,
      url: row.url,
      show: row.is_show,
      cache: row.cache,
      status: row.status,
      affix: row.affix,
      permission: row.permission,
      menuActiveName: row.menu_active_name,
      menuActiveSameTab: row.menu_active_same_tab,
      badge: row.badge,
      activeIcon: row.active_icon,
      position: row.position,
      leaveTip: row.leave_tip,
      maskUrl: row.mask_url,
      hijackRefresh: row.hijack_refresh,
      watermark: row.watermark,
      transition: row.transition,
      cacheKeyStrategy: row.cache_key_strategy,
    }
    return {
      _id: row.id,
      pid: row.pid,
      type: row.type,
      path: row.path,
      name: row.name,
      component: row.component,
      icon: row.icon,
      title: row.title,
      meta,
      ...timestampsOf(row),
    }
  },
  sys_lang: row => ({
    _id: row.id,
    lang: row.lang,
    description: row.description,
    order: row.sort_order,
    status: row.status,
    ...timestampsOf(row),
  }),
  sys_locale: row => ({
    _id: row.id,
    langId: row.lang_id,
    key: row.key,
    value: row.value,
    ...timestampsOf(row),
  }),
  sys_dict_type: row => ({
    _id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    description: row.description,
    ...timestampsOf(row),
  }),
  sys_dict_data: row => ({
    _id: row.id,
    typeId: row.type_id,
    label: row.label,
    value: row.value,
    order: row.sort_order,
    status: row.status,
    tagType: row.tag_type,
    description: row.description,
    ...timestampsOf(row),
  }),
  app_setting: row => ({
    _id: row.id,
    settingName: row.setting_name,
    settingKey: row.setting_key,
    settingValue: row.setting_value,
    settingType: row.setting_type,
    remark: row.remark,
    createdBy: row.created_by,
    ...timestampsOf(row),
  }),
  shared_area: row => ({
    _id: row.id,
    code: row.code,
    name: row.name,
    pcode: row.pcode,
  }),
}

/** 导出一个集合：PG 全行 → 反向映射 → 排序 → 套策略（→ 脱敏），返回文本与条数 */
export async function exportPgCollection(
  pg: Client,
  name: string,
  extras: { junctionRows: readonly PgRow[] },
  anonymize: boolean,
): Promise<{ text: string, count: number }> {
  const mapper = REVERSE_MAPPERS[name]
  if (mapper === undefined)
    throw new PreconditionError(`集合 ${name} 没有反向映射（export-pg.ts 的 REVERSE_MAPPERS）`)
  const result = await pg.query(`SELECT * FROM ${name} ORDER BY id`)
  const docs = (result.rows as PgRow[]).map(row => mapper(row, extras)).sort((a, b) => String(a._id).localeCompare(String(b._id)))
  const curated = applyPolicy(name, docs)
  const final = anonymize ? anonymizeDocs(curated) : curated
  return { text: stringifyCollectionFile(final), count: final.length }
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseExportPgArgs(process.argv.slice(2))
  const sourceDir = resolvePath(repoRoot, opts.seedDir)
  // junction 文件（sys_user_role / sys_role_menu）在导出形态里是**父文档的数组**，不单独导出
  const names = listSeedCollections(sourceDir)
    .filter(name => !JUNCTION_TABLES.includes(name))
    .filter(name => opts.only === undefined || opts.only.includes(name))
  if (names.length === 0)
    throw new PreconditionError(`没有可导出的集合（${sourceDir} 里没有 .json）`)

  const outDir = resolvePath(repoRoot, opts.outDir)
  // 与 Mongo 版同一条红线：脱敏是有损的，永远不许写回仓内 seed
  if (opts.anonymize && resolvePath(repoRoot, opts.outDir) === resolvePath(repoRoot, opts.seedDir)) {
    throw new PreconditionError(
      '脱敏导出必须用 --out 指定一个**别的**目录（例如 --out apps/server/.tmp/pg-snapshot）——'
      + ' 脱敏是有损的，别让掩码快照覆盖仓内 seed',
    )
  }
  // 真源是 PG 行形态：Extended JSON 写进 seed 目录 = 把真源打回旧格式（lint:seed 也会判红）
  if (resolvePath(repoRoot, opts.outDir) === resolvePath(repoRoot, opts.seedDir)) {
    throw new PreconditionError(
      '导出结果**不能**写进 seed 目录：那里是 PG 行形态真源，本命令产出的是 Extended JSON 快照。'
      + ' 要再生成真源请两步：\n'
      + '    pnpm db:export:pg --out apps/server/.tmp/pg-export\n'
      + '    pnpm db:seed:reshape --from apps/server/.tmp/pg-export',
    )
  }

  const { target } = resolvePgTarget(repoRoot, opts.envFile === '' ? undefined : opts.envFile, opts.pgDbName)
  out(`导出集合：${names.length} 个（按仓内文件名清单；uuid 口径见 export-pg.ts 头注）`)
  out(`目标目录：${opts.outDir}`)

  const pg = new Client(target)
  await pg.connect()
  try {
    // 数据权限三期：导出必须完整。本通道走管理角色（DATABASE_PG_USER），正常是
    // superuser / BYPASSRLS；若误配成普通角色，`SET row_security = off` 会让 PG 对
    // 启用 RLS 的表**直接报错**（而不是静默少行）—— 刻意选“响亮失败”，不降级。
    const roleInfo = (await pg.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    )).rows[0] as { rolsuper: boolean, rolbypassrls: boolean } | undefined

    if (roleInfo !== undefined && !roleInfo.rolsuper && !roleInfo.rolbypassrls) {
      out('警告：导出角色既非 superuser 也无 BYPASSRLS —— 依赖 SET row_security = off 的报错保护')
    }
    await pg.query('SET row_security = off')

    // junction 预取：sys_user.roles / sys_role.menus 反向拼数组
    const userRoles = (await pg.query('SELECT user_id, role_id FROM sys_user_role')).rows
    const roleMenus = (await pg.query('SELECT role_id, menu_id FROM sys_role_menu')).rows

    mkdirSync(outDir, { recursive: true })
    for (const name of names) {
      const junctionRows = name === 'sys_user' ? userRoles : name === 'sys_role' ? roleMenus : []
      const { text, count } = await exportPgCollection(pg, name, { junctionRows }, opts.anonymize)
      writeFileSync(join(outDir, `${name}.json`), text)
      out(`  ${name.padEnd(16)} ${String(count).padStart(6)} 条`)
    }

    if (opts.areas !== undefined) {
      const { text, count } = await exportPgCollection(pg, 'shared_area', { junctionRows: [] }, opts.anonymize)
      const areasPath = resolvePath(repoRoot, opts.areas)
      mkdirSync(dirname(areasPath), { recursive: true })
      writeFileSync(areasPath, text)
      out(`  shared_area（另存）  ${String(count).padStart(6)} 条 -> ${opts.areas}`)
    }

    line('ok', `PG 导出完成：${names.length} 个集合（PG 生态回灌格式，非 Mongo seed 字节口径）`)
  }
  finally {
    await pg.end()
  }
}
