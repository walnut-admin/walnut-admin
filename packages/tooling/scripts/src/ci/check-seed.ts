/**
 * `pnpm lint:seed` —— 初始化数据集（`apps/server/db/seed/`）的形态门禁。
 *
 * ## 为什么它必须存在
 *
 * 这份数据是**随仓库发布、且被 `db:seed:pg` 直接灌进库**的。它的失效方式全是静默的：
 *
 * | 失效 | 症状 |
 * |------|------|
 * | 有人把 `app_key` / `sys_user_identity` 手工导进来 | **私钥与凭证进了公开仓**（本仓的 `lint:secrets` 未必认得出 JSON 里的 `key_b64`） |
 * | 有人塞了 `shared_area` | 89MB 进 git 历史，克隆与每次 diff 都陪葬 |
 * | 有人直接 dump 了未裁剪的 `sys_user` | 开发者本人账号被发布出去（原始导出里就有） |
 * | 引用被改坏（角色指向不存在的菜单、用户指向不存在的角色） | 登录后侧边栏/权限**空掉**，而没有任何报错 |
 * | 有人把 Extended JSON（`$oid` / `$date`）塞回来 | 真源退回「Mongo 形态 + 运行时映射」，中间层又会长出来 |
 *
 * 判据全部落在**数据本身**（不需要数据库），所以它能进 prepush 与 CI。
 * 「与 `db:export:pg` 往返一致」那一条需要真实库，由 `pnpm db:seed:verify`（两库对拍）兜 ——
 * 不放进这里，否则门禁会依赖环境。
 *
 * ## 数据形态（2026-11 批次 5-B 起）
 *
 * 每个文件是一个 **PG 行数组**：`{ id: <uuid>, <snake_case 列>: … }`；junction 表
 * （`sys_user_role` / `sys_role_menu`）各有独立文件、没有 `id` 列。时间列是 ISO 字符串。
 */
import type { SeedPolicy } from '../db/policy.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { findUnmaskedPersonal } from '../db/anonymize.ts'
import { applyPolicy, SEED_POLICY } from '../db/policy.ts'
import { JUNCTION_TABLES, SEED_TABLES } from '../db/seed-reshape.ts'
import { UUID_RE } from '../db/uuid5.ts'
import { ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'

/** 数据集总预算与单文件预算（字节）。当前约 0.9MB / 最大单文件 0.6MB，留了余量。 */
export const TOTAL_BUDGET_BYTES = 2 * 1024 * 1024
export const FILE_BUDGET_BYTES = 1024 * 1024

/** 必须存在的表（少一个，装出来的环境就缺一块） */
export const REQUIRED_COLLECTIONS = [
  'app_setting',
  'sys_dict_data',
  'sys_dict_type',
  'sys_lang',
  'sys_locale',
  'sys_menu',
  'sys_role',
  'sys_user',
]

/** 必须存在的 junction 文件（少了它，登录后权限/菜单是空的，而没有任何报错） */
export const REQUIRED_JUNCTION_COLLECTIONS = ['sys_role_menu', 'sys_user_role']

/** 明确**不许**进仓的集合 —— 与 `apps/server/db/seed/README.md` 里那张表一一对应 */
export const FORBIDDEN_COLLECTIONS = [
  'app_key',
  'shared_area',
  'sys_device',
  'sys_user_device',
  'sys_user_identity',
  'sys_user_mfa',
  'sys_user_oauth',
]

/**
 * `app_setting` 里必须存在的显式默认行（P2-15，2026-10-28）。
 *
 * 为什么进机械门禁：`app.global.ipBlackList` 是永久 IP 黑名单的**唯一写回锚点** ——
 * `addToPermanentBlackList` 先 findAppSettingByKey 再 updateAppSettingByKey，后者对
 * 不存在的 key 静默 no-op（对齐 Mongo findOneAndUpdate 语义）。零配置部署只跑 migration 时，
 * 黑名单永远不会真正积累，扫描器每次只拿到 40610、IP 不被记住，读取腿还会把缺失键兜底成
 * `[]` —— 问题完全静默。seed 是唯一能补上这一行的通道，所以「这一行在 seed 里」本身必须是
 * 可机械核对的判据，不能靠人记得。
 *
 * 值形态对照 cache.appSettings 的读取口径：`setting_value` 是 JSON 字符串，读腿
 * `JSON.parse` 后当 string[] 用 —— 因此这里也要求可解析为字符串数组。
 */
export const REQUIRED_APP_SETTING_KEYS: ReadonlyArray<{ key: string, validate: (value: string) => string | null }> = [
  {
    key: 'app.global.ipBlackList',
    validate: (value) => {
      try {
        const parsed = JSON.parse(value) as unknown
        return Array.isArray(parsed) && parsed.every(item => typeof item === 'string')
          ? null
          : 'value 必须是 JSON 字符串数组（如 "[]"）'
      }
      catch {
        return 'value 不是合法 JSON（读腿 JSON.parse 会兜底成 []，黑名单静默失效）'
      }
    },
  },
]

/**
 * 凭据形状的键名：出现即说明有人把不该发的数据导进来了。
 * 文档形态（驼峰，历史导出）与行形态（snake_case，现真源）两种都列 —— 名单要能拦住两种入口。
 */
export const FORBIDDEN_KEYS = [
  'privateKeyPem',
  'keyB64',
  'totpSecretCiphertext',
  'backupCodesCiphertext',
  'valueHash',
  'private_key_pem',
  'key_b64',
  'totp_secret_ciphertext',
  'backup_codes_ciphertext',
  'value_hash',
]

/** Extended JSON 包装：曾经的真源形态，现在是「退化信号」 */
export const LEGACY_EJSON_MARKERS = ['"$oid"', '"$date"']

export interface SeedFinding {
  file: string
  detail: string
}

interface Row extends Record<string, unknown> {}

/** 收集所有问题（纯函数式：给个仓库根目录就能跑，便于用例拿临时目录构造反例） */
export function collectFindings(repoRoot: string, seedDir = 'apps/server/db/seed'): SeedFinding[] {
  const dir = join(repoRoot, seedDir)
  const findings: SeedFinding[] = []
  const add = (file: string, detail: string): void => {
    findings.push({ file, detail })
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  const names = files.map(f => f.replace(/\.json$/, ''))

  for (const required of REQUIRED_COLLECTIONS) {
    if (!names.includes(required))
      add(seedDir, `缺少必需集合 ${required}.json（装出来的环境会缺一块）`)
  }
  for (const required of REQUIRED_JUNCTION_COLLECTIONS) {
    if (!names.includes(required))
      add(seedDir, `缺少必需 junction 文件 ${required}.json（登录后权限/菜单会空掉且不报错）`)
  }
  for (const forbidden of FORBIDDEN_COLLECTIONS) {
    if (names.includes(forbidden))
      add(`${seedDir}/${forbidden}.json`, `这个集合**刻意不进仓**（理由见该目录 README），请删掉它`)
  }
  const known = new Set<string>([...SEED_TABLES, ...JUNCTION_TABLES])
  for (const name of names) {
    if (!known.has(name))
      add(`${seedDir}/${name}.json`, `未登记的表文件（既不是业务集合也不是 junction）—— 先确认它该不该进仓`)
  }

  let total = 0
  for (const file of files) {
    const rel = `${seedDir}/${file}`
    const size = statSync(join(dir, file)).size
    total += size
    if (size > FILE_BUDGET_BYTES)
      add(rel, `单文件 ${(size / 1024).toFixed(0)}KB 超过预算 ${FILE_BUDGET_BYTES / 1024}KB —— 这种体量该考虑当发版资产发`)

    const text = readFileSync(join(dir, file), 'utf8')

    // 凭据形状（先扫原文：解析失败也照样能报出来）
    for (const key of FORBIDDEN_KEYS) {
      if (text.includes(`"${key}"`))
        add(rel, `出现凭据形状的字段 \`${key}\` —— 这类数据（密钥/凭证/MFA 密文）不能进公开仓`)
    }
    // 真源形态：出现 Extended JSON 包装说明有人把历史导出原样塞回来了
    for (const marker of LEGACY_EJSON_MARKERS) {
      if (text.includes(marker))
        add(rel, `出现 Extended JSON 包装 ${marker} —— 真源是 PG 行形态（\`{ id, created_at, … }\`），历史导出请先 reshape`)
    }

    let rows: Row[]
    try {
      rows = parseSeedFile(text)
    }
    catch (error) {
      add(rel, `解析失败：${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    findings.push(...findRowShape(file, rel, rows))

    // 未脱敏的个人数据：用**与 `db:export:pg --anonymize` 同一套规则**自检（`db/anonymize.ts`）——
    // 于是"有人把带真实个人数据的集合放进仓"与"字段改名绕过脱敏规则"都会在这里被点名到字段路径。
    for (const hit of rows.flatMap(row => findUnmaskedPersonal(row)).slice(0, 5))
      add(rel, `未脱敏的个人数据：${hit}（判据见 db/anonymize.ts；这类数据不该进仓）`)

    // 裁剪必须已经生效：拿策略再跑一遍，结果必须与文件内容一致（否则说明有人导了未裁剪的原始数据）
    const collection = file.replace(/\.json$/, '')
    const policy = SEED_POLICY[collection] as SeedPolicy | undefined
    if (policy !== undefined) {
      const curated = applyPolicy(collection, rows)
      if (JSON.stringify(curated) !== JSON.stringify(rows))
        add(rel, `内容未按 policy.ts 裁剪（例如 ${collection} 里混进了非演示账号或未置空的头像）—— 请重新生成 seed`)
    }
  }

  if (total > TOTAL_BUDGET_BYTES)
    add(seedDir, `数据集合计 ${(total / 1024).toFixed(0)}KB 超过预算 ${TOTAL_BUDGET_BYTES / 1024}KB`)

  const loaded = new Map<string, Row[] | undefined>()
  for (const file of files) {
    try {
      loaded.set(file.replace(/\.json$/, ''), parseSeedFile(readFileSync(join(dir, file), 'utf8')))
    }
    catch {
      loaded.set(file.replace(/\.json$/, ''), undefined)
    }
  }

  findings.push(...referentialFindings(loaded, seedDir))
  findings.push(...appSettingFindings(loaded.get('app_setting'), seedDir))
  return findings
}

/** 解析一个 seed 文件：必须是**行数组**（纯 JSON，不认 Extended JSON 包装） */
export function parseSeedFile(text: string): Row[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed))
    throw new TypeError('seed 文件必须是行数组（JSON array）')
  return parsed as Row[]
}

/**
 * 行形态判据：
 * - 业务表每行必须有 uuid 的 `id` 与 `created_at` / `updated_at`（ISO 字符串）；
 * - junction 表两列都必须是 uuid（复合主键，没有 `id`）；
 * - 同一文件里所有行的列集一致（不一致说明有人手改了某一行，灌库时会错位/静默漏列）。
 */
function findRowShape(file: string, rel: string, rows: Row[]): SeedFinding[] {
  if (rows.length === 0)
    return []
  const collection = file.replace(/\.json$/, '')
  const isJunction = JUNCTION_TABLES.includes(collection)
  const first = rows[0]
  const cols = Object.keys(first)
  const local: SeedFinding[] = []

  for (const [index, row] of rows.entries()) {
    const where = `${rel} 第 ${index} 行`
    const keys = Object.keys(row)
    if (keys.length !== cols.length || keys.some(key => !cols.includes(key))) {
      local.push({ file: rel, detail: `${where} 的列集与首行不一致（列集必须逐行一致：${cols.join(', ')}）` })
      break
    }
    if (isJunction) {
      const bad = keys.filter(key => typeof row[key] !== 'string' || !UUID_RE.test(String(row[key])))
      if (bad.length > 0)
        local.push({ file: rel, detail: `${where} 的 ${bad.join(', ')} 必须是 uuid（junction 表是复合主键）` })
      if (keys.includes('id'))
        local.push({ file: rel, detail: `${where} 不该有 id 列（${collection} 是 junction 表，主键是两列引用）` })
      continue
    }
    if (typeof row.id !== 'string' || !UUID_RE.test(row.id))
      local.push({ file: rel, detail: `${where} 的 id 必须是 uuid（PG 主键本体），收到：${String(row.id)}` })
    for (const column of ['created_at', 'updated_at']) {
      const value = row[column]
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
        local.push({ file: rel, detail: `${where} 的 ${column} 必须是 ISO 时间字符串（PG timestamptz 直接吃它）` })
    }
  }

  if (!isJunction && !cols.includes('id'))
    local.push({ file: rel, detail: `业务表文件没有 id 列 —— 必须是行形态（\`{ id, … }\`）` })

  return local
}

/**
 * `app_setting` 显式默认行：键必须存在、值必须可被读腿原样解析。
 * 缺行 / 形态不对都点名到 setting_key，避免「seed 跑完看起来成功、黑名单写腿永远 no-op」。
 */
function appSettingFindings(rows: Row[] | undefined, seedDir: string): SeedFinding[] {
  if (rows === undefined)
    return []

  const findings: SeedFinding[] = []
  for (const requirement of REQUIRED_APP_SETTING_KEYS) {
    const row = rows.find(item => item.setting_key === requirement.key)
    if (row === undefined) {
      findings.push({
        file: `${seedDir}/app_setting.json`,
        detail: `缺少显式默认行 ${requirement.key}（写腿对缺失键静默 no-op，永久黑名单永远不会积累）`,
      })
      continue
    }

    const value = row.setting_value
    if (typeof value !== 'string') {
      findings.push({ file: `${seedDir}/app_setting.json`, detail: `${requirement.key} 的 setting_value 必须是 JSON 字符串` })
      continue
    }

    const error = requirement.validate(value)
    if (error !== null)
      findings.push({ file: `${seedDir}/app_setting.json`, detail: `${requirement.key} 形态不对：${error}` })
  }

  return findings
}

/**
 * 引用完整性：junction 的两端、用户当前角色、设置的默认角色、菜单父子、语言/字典的外键。
 *
 * 为什么要在**数据侧**再查一遍（PG 有 FK）：这些行是**分文件**的，删掉一个文件/改坏一个 id
 * 时 PG 会在灌库那一刻报错，而报错信息只在你真的去灌库时才看得到；这里是「提交就红」。
 */
function referentialFindings(loaded: ReadonlyMap<string, Row[] | undefined>, seedDir: string): SeedFinding[] {
  const findings: SeedFinding[] = []
  const ids = (name: string): Set<string> => new Set((loaded.get(name) ?? []).map(row => String(row.id)))

  const roleIds = ids('sys_role')
  const menuIds = ids('sys_menu')
  const userIds = ids('sys_user')
  const langIds = ids('sys_lang')
  const dictTypeIds = ids('sys_dict_type')

  for (const row of loaded.get('sys_user_role') ?? []) {
    if (!userIds.has(String(row.user_id)))
      findings.push({ file: `${seedDir}/sys_user_role.json`, detail: `授权行指向不存在的用户 ${String(row.user_id)}（这条授权会被静静丢掉）` })
    if (!roleIds.has(String(row.role_id)))
      findings.push({ file: `${seedDir}/sys_user_role.json`, detail: `授权行指向不存在的角色 ${String(row.role_id)}（登录后权限会空掉且不报错）` })
  }

  for (const row of loaded.get('sys_role_menu') ?? []) {
    if (!roleIds.has(String(row.role_id)))
      findings.push({ file: `${seedDir}/sys_role_menu.json`, detail: `授权行指向不存在的角色 ${String(row.role_id)}` })
    if (!menuIds.has(String(row.menu_id)))
      findings.push({ file: `${seedDir}/sys_role_menu.json`, detail: `角色 ${String(row.role_id)} 指向不存在的菜单 ${String(row.menu_id)}` })
  }

  for (const row of loaded.get('sys_user') ?? []) {
    const current = row.current_role_id
    if (current !== null && current !== undefined && !roleIds.has(String(current)))
      findings.push({ file: `${seedDir}/sys_user.json`, detail: `${String(row.user_name)} 的 current_role_id 指向不存在的角色 ${String(current)}` })
  }

  const defaultRole = String((loaded.get('app_setting') ?? []).find(row => row.setting_key === 'app.default.role')?.setting_value ?? '')
  if (defaultRole !== '' && !roleIds.has(defaultRole))
    findings.push({ file: `${seedDir}/app_setting.json`, detail: `app.default.role 指向不存在的角色 ${defaultRole}（新用户注册会落到空角色）` })

  for (const row of loaded.get('sys_menu') ?? []) {
    const pid = row.pid
    if (pid !== null && pid !== undefined && !menuIds.has(String(pid)))
      findings.push({ file: `${seedDir}/sys_menu.json`, detail: `菜单 ${String(row.title ?? row.id)} 的 pid 指向不存在的菜单 ${String(pid)}` })
  }

  for (const row of loaded.get('sys_locale') ?? []) {
    if (!langIds.has(String(row.lang_id)))
      findings.push({ file: `${seedDir}/sys_locale.json`, detail: `语言包 ${String(row.key)} 的 lang_id 指向不存在的语言 ${String(row.lang_id)}` })
  }

  for (const row of loaded.get('sys_dict_data') ?? []) {
    if (!dictTypeIds.has(String(row.type_id)))
      findings.push({ file: `${seedDir}/sys_dict_data.json`, detail: `字典 ${String(row.label)} 的 type_id 指向不存在的字典类型 ${String(row.type_id)}` })
  }

  return findings
}

export function main(): void {
  const repoRoot = process.cwd()
  const files = readdirSync(join(repoRoot, 'apps/server/db/seed')).filter(f => f.endsWith('.json'))
  out(`初始化数据检查：${files.length} 个表文件（必需 ${REQUIRED_COLLECTIONS.length} + junction ${REQUIRED_JUNCTION_COLLECTIONS.length} / 禁入 ${FORBIDDEN_COLLECTIONS.length}）`)

  const findings = collectFindings(repoRoot)
  if (findings.length === 0) {
    line('ok', '数据集形态正确：必需表齐全、无凭据形状、无 Extended JSON 残留、体积在预算内、引用完整、裁剪已生效')
    return
  }

  for (const f of findings)
    lineErr('violation', `${f.file}\n    ${f.detail}`)
  err(`\n共 ${findings.length} 处。这份数据会**随仓库发布并直接灌进库**，所以它的形态就是运行期行为。`)
  throw new ViolationError(`初始化数据有 ${findings.length} 处问题（明细见上）`)
}
