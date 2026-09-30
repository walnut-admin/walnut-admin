/**
 * `pnpm lint:seed` —— 初始化数据集（`apps/server/db/seed/`）的形态门禁。
 *
 * ## 为什么它必须存在
 *
 * 这份数据是**随仓库发布、且被 `db:seed` 直接灌进库**的。它的失效方式全是静默的：
 *
 * | 失效 | 症状 |
 * |------|------|
 * | 有人把 `app_key` / `sys_user_identity` 手工导进来 | **私钥与凭证进了公开仓**（本仓的 `lint:secrets` 未必认得出 JSON 里的 `keyB64`） |
 * | 有人塞了 `shared_area` | 89MB 进 git 历史，克隆与每次 diff 都陪葬 |
 * | 有人直接 dump 了未裁剪的 `sys_user` | 开发者本人账号被发布出去（原始导出里就有） |
 * | 引用被改坏（角色指向不存在的菜单、用户指向不存在的角色） | 登录后侧边栏/权限**空掉**，而没有任何报错 |
 * | 数据被换成"原样导出" | `db:export` 与仓内文件不再一致，「仓是真源」这条约定失效 |
 *
 * 判据全部落在**数据本身**（不需要数据库），所以它能进 prepush 与 CI。
 * 「与 `db:export` 往返一致」那一条需要真实库，由 `pnpm db:export` 之后看 `git diff` 兜
 * —— 不放进这里，否则门禁会依赖环境。
 */
import type { SeedPolicy } from '../db/policy.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { findUnmaskedPersonal } from '../db/anonymize.ts'
import { parseCollectionFile } from '../db/ejson.ts'
import { applyPolicy, SEED_POLICY } from '../db/policy.ts'
import { ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'

/** 数据集总预算与单文件预算（字节）。当前约 0.78MB / 最大单文件 0.6MB，留了余量。 */
export const TOTAL_BUDGET_BYTES = 2 * 1024 * 1024
export const FILE_BUDGET_BYTES = 1024 * 1024

/** 必须存在的集合（少一个，装出来的环境就缺一块） */
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

/** 凭据形状的键名：出现即说明有人把不该发的数据导进来了 */
export const FORBIDDEN_KEYS = ['privateKeyPem', 'keyB64', 'totpSecretCiphertext', 'backupCodesCiphertext', 'valueHash']

export interface SeedFinding {
  file: string
  detail: string
}

interface Doc extends Record<string, unknown> {}

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
  for (const forbidden of FORBIDDEN_COLLECTIONS) {
    if (names.includes(forbidden))
      add(`${seedDir}/${forbidden}.json`, `这个集合**刻意不进仓**（理由见该目录 README），请删掉它`)
  }

  let total = 0
  for (const file of files) {
    const rel = `${seedDir}/${file}`
    const size = statSync(join(dir, file)).size
    total += size
    if (size > FILE_BUDGET_BYTES)
      add(rel, `单文件 ${(size / 1024).toFixed(0)}KB 超过预算 ${FILE_BUDGET_BYTES / 1024}KB —— 这种体量该考虑当发版资产发`)

    let docs: Doc[]
    try {
      docs = parseCollectionFile(readFileSync(join(dir, file), 'utf8')) as Doc[]
    }
    catch (error) {
      add(rel, `解析失败：${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    // 凭据形状
    const text = readFileSync(join(dir, file), 'utf8')
    for (const key of FORBIDDEN_KEYS) {
      if (text.includes(`"${key}"`))
        add(rel, `出现凭据形状的字段 \`${key}\` —— 这类数据（密钥/凭证/MFA 密文）不能进公开仓`)
    }

    // 未脱敏的个人数据：用**与 `db:export --anonymize` 同一套规则**自检（`db/anonymize.ts`）——
    // 于是"有人把带真实个人数据的集合放进仓"与"字段改名绕过脱敏规则"都会在这里被点名到字段路径。
    for (const hit of docs.flatMap(doc => findUnmaskedPersonal(doc)).slice(0, 5))
      add(rel, `未脱敏的个人数据：${hit}（判据见 db/anonymize.ts；这类数据不该进仓）`)

    // 裁剪必须已经生效：拿策略再跑一遍，结果必须与文件内容一致（否则说明有人导了未裁剪的原始数据）
    const policy = SEED_POLICY[file.replace(/\.json$/, '')] as SeedPolicy | undefined
    if (policy !== undefined) {
      const curated = applyPolicy(file.replace(/\.json$/, ''), docs)
      if (JSON.stringify(curated) !== JSON.stringify(docs))
        add(rel, `内容未按 policy.ts 裁剪（例如 ${file.replace(/\.json$/, '')} 里混进了非演示账号或未置空的头像）—— 请跑 pnpm db:export 重新导出`)
    }
  }

  if (total > TOTAL_BUDGET_BYTES)
    add(seedDir, `数据集合计 ${(total / 1024).toFixed(0)}KB 超过预算 ${TOTAL_BUDGET_BYTES / 1024}KB`)

  findings.push(...referentialFindings(dir, files, seedDir))
  return findings
}

/** 引用完整性：角色→菜单、用户→角色、设置里的默认角色、菜单父子 */
function referentialFindings(dir: string, files: string[], seedDir: string): SeedFinding[] {
  const findings: SeedFinding[] = []
  const load = (name: string): Doc[] | undefined => {
    if (!files.includes(`${name}.json`))
      return undefined
    return parseCollectionFile(readFileSync(join(dir, `${name}.json`), 'utf8')) as Doc[]
  }
  const ids = (docs: Doc[] | undefined): Set<string> => new Set((docs ?? []).map(d => String(d._id)))

  const roleIds = ids(load('sys_role'))
  const menuIds = ids(load('sys_menu'))

  for (const user of load('sys_user') ?? []) {
    for (const role of (user.roles as unknown[] | undefined) ?? []) {
      if (!roleIds.has(String(role)))
        findings.push({ file: `${seedDir}/sys_user.json`, detail: `${String(user.userName)} 指向不存在的角色 ${String(role)}（登录后权限会空掉且不报错）` })
    }
    const current = user.currentRole as { _id?: unknown } | undefined
    if (current?._id !== undefined && !roleIds.has(String(current._id)))
      findings.push({ file: `${seedDir}/sys_user.json`, detail: `${String(user.userName)} 的 currentRole 指向不存在的角色 ${String(current._id)}` })
  }

  for (const role of load('sys_role') ?? []) {
    for (const menu of (role.menus as unknown[] | undefined) ?? []) {
      if (!menuIds.has(String(menu)))
        findings.push({ file: `${seedDir}/sys_role.json`, detail: `角色 ${String(role.roleName)} 指向不存在的菜单 ${String(menu)}` })
    }
  }

  const defaultRole = String((load('app_setting') ?? []).find(s => s.settingKey === 'app.default.role')?.settingValue ?? '')
  if (defaultRole !== '' && !roleIds.has(defaultRole))
    findings.push({ file: `${seedDir}/app_setting.json`, detail: `app.default.role 指向不存在的角色 ${defaultRole}（新用户注册会落到空角色）` })

  for (const menu of load('sys_menu') ?? []) {
    const pid = menu.pid
    if (pid !== undefined && pid !== null && String(pid) !== '' && !menuIds.has(String(pid)))
      findings.push({ file: `${seedDir}/sys_menu.json`, detail: `菜单 ${String(menu.title ?? menu._id)} 的 pid 指向不存在的菜单 ${String(pid)}` })
  }

  return findings
}

export function main(): void {
  const repoRoot = process.cwd()
  const files = readdirSync(join(repoRoot, 'apps/server/db/seed')).filter(f => f.endsWith('.json'))
  out(`初始化数据检查：${files.length} 个集合（必需 ${REQUIRED_COLLECTIONS.length} 个 / 禁入 ${FORBIDDEN_COLLECTIONS.length} 个）`)

  const findings = collectFindings(repoRoot)
  if (findings.length === 0) {
    line('ok', '数据集形态正确：必需集合齐全、无凭据形状、体积在预算内、引用完整、裁剪已生效')
    return
  }

  for (const f of findings)
    lineErr('violation', `${f.file}\n    ${f.detail}`)
  err(`\n共 ${findings.length} 处。这份数据会**随仓库发布并直接灌进库**，所以它的形态就是运行期行为。`)
  throw new ViolationError(`初始化数据有 ${findings.length} 处问题（明细见上）`)
}
