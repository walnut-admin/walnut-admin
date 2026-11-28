/**
 * `db:credential-check` —— **只读**口令凭证探针：库存的 password 身份行在本环境还能不能登录。
 *
 * ## 为什么需要它
 *
 * 2026-11 的两次凭证绑定面演进（OPAQUE 登录要求 identifiers；① 起 password 身份落库改
 * AES-GCM 信封）都是**静默变砖**：旧行还躺在库里，登录却统一 40103，报错不指向任何可执行动作。
 * 这条命令把「库里这份凭证能不能被当前 env 解开」变成一次可机检的探针 —— 部署后、改密钥后、
 * 怀疑登录问题时先跑它，比逐个账号试登录快，也不产生登录失败计数 / 风控记录。
 *
 * ## 判据（与 `db:seed:pg --admin` 的写入口径逐字对齐）
 *
 * - 解 `sys_user_identity.value`：AES-256-GCM，iv || ciphertext || authTag 的 base64，
 *   AAD `sys_user_identity`，key = `USER_ID_ENCRYPTION_KEY`（镜像函数在 `admin-credential.ts`，
 *   真源是服务端 `SysUserIdentitySharedService` / `AppTechCryptoService`）；
 * - 解密出来的 registration record 必须是 base64(URL) 形态（OPAQUE 序列化形状）；
 * - `value_hash` 必须等于 `HMAC-SHA256(USER_ID_HASH_SALT, 明文 record)`（与 `generateHashValue` 同口径）。
 *
 * ## 它**不能**验证什么
 *
 * identifiers 绑定（2026-11-24 起注册必须带 `{ client: userName, server: 'walnut-admin' }`）
 * 只在客户端 `client.finishLogin` 阶段暴露（返回 undefined），没有口令就无法在离线探针里
 * 重放一次完整握手。所以探针报 `ok` 只代表「密文与哈希自洽」，不代替 `--admin` 自验的登录
 * 握手（那条命令写完后会真的跑一遍 OPAQUE 登录）。
 *
 * ## 退出码
 *
 * 沿用 `runCli` 的四态：全部 ok ⇒ 0；任一行格式不可用（`stale-format` / `missing-identity`）
 * 或 valueHash 不一致 ⇒ 抛 `ViolationError` ⇒ 1（可进自动化）。本命令天然只读，不需要 `--dry-run`。
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { decryptIdentityValue, hashIdentityValue } from './admin-credential.ts'
import { resolvePgTarget } from './pg-conn.ts'
import { parseEnvFile } from './seed.ts'

export interface CredentialCheckOptions {
  /** `--env-file`：相对路径按仓库根解（与 `db:seed:pg` 同口径） */
  envFile: string
  /** `--pg-db`：覆盖 env 里的 DATABASE_PG_NAME */
  pgDbName?: string
}

/** 与 `db:seed:pg` 的参数风格对齐（只保留本命令需要的两个） */
export function parseCredentialCheckArgs(argv: readonly string[]): CredentialCheckOptions {
  const opts: CredentialCheckOptions = { envFile: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined) throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--pg-db':
        opts.pgDbName = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --pg-db / --env-file）`)
    }
  }
  return opts
}

export interface IdentityCryptoKeys {
  encryptionKey: string
  hashSalt: string
}

/**
 * 从后端那份 env 文件取两把身份密钥。**不启 Nest**，与 `seed-pg.ts` 的
 * `readAdminCredentialKeys` 同一组变量名（真源：`libs/config/src/modules/crypto.config.ts`）。
 */
export function readIdentityCryptoKeys(envFile: string): IdentityCryptoKeys {
  const env = parseEnvFile(readFileSync(envFile, 'utf8'))
  const encryptionKey = env.USER_ID_ENCRYPTION_KEY
  const hashSalt = env.USER_ID_HASH_SALT
  if (
    encryptionKey === undefined ||
    encryptionKey === '' ||
    hashSalt === undefined ||
    hashSalt === ''
  ) {
    throw new PreconditionError(
      `env 里缺 USER_ID_ENCRYPTION_KEY / USER_ID_HASH_SALT（${envFile}）—— 必须与后端实际使用的那份同源`,
    )
  }
  return { encryptionKey, hashSalt }
}

export type CredentialFormat = 'ok' | 'stale-format' | 'missing-identity'

/** 与 `sys_user_identity` 的物理列同名（只取探针需要的四列） */
export interface PasswordIdentityRow {
  userName: string | null
  userId: string
  value: string | null
  valueHash: string | null
}

export interface CredentialCheckRow {
  /** 账号名（join 不到用户时给占位，不隐藏脏行） */
  userName: string
  userId: string
  format: CredentialFormat
  /** 解密出的 record 的盐化 HMAC 是否等于库里的 value_hash；解不开 / 缺值为 null */
  hashMatch: boolean | null
  /** 人类可读的判定依据（**绝不包含密文或明文凭证内容**） */
  detail: string
  /** 下一步动作（`—` = 不用做什么） */
  suggestion: string
}

/** OPAQUE 的 registration record 序列化是 base64url（实测含 `-` / `_`，长度 256） */
const BASE64URL_RECORD = /^[\w+/=-]+$/

/**
 * 解密后的内容是否像一份 OPAQUE registration record。
 *
 * 只做**形状**判断（合法 base64url、长度够、4 的倍数）：探针要抓的是「旧明文 / 被换过
 * 密钥的值被当成密文」这类格式漂移，不是重新实现 OPAQUE 的解析器。
 */
export function looksLikeRegistrationRecord(value: string): boolean {
  return value.length >= 64 && value.length % 4 === 0 && BASE64URL_RECORD.test(value)
}

function seedSuggestion(userName: string): string {
  return `pnpm walnut db:seed:pg --admin ${userName} --password <新口令>`
}

/**
 * 单行判定（纯函数：输入行 + 两把密钥，输出探针表的一行）。
 *
 * 三类格式：
 * - `missing-identity`：value 为空（行存在但没内容）；
 * - `stale-format`：AES-GCM 解不开，或解出来不是 base64url 记录（旧明文 / 换过密钥 / 坏行）；
 * - `ok`：解开了；`hashMatch` 单独报告 value_hash 是否自洽。
 */
export function analyzePasswordIdentity(
  row: PasswordIdentityRow,
  keys: IdentityCryptoKeys,
): CredentialCheckRow {
  const userName = row.userName ?? '(未关联用户)'
  const base = { userName, userId: row.userId }

  if (row.value === null || row.value.trim() === '') {
    return {
      ...base,
      format: 'missing-identity',
      hashMatch: null,
      detail: 'value 列为空（没有可用的口令记录）',
      suggestion: seedSuggestion(userName),
    }
  }

  let plain: string
  try {
    plain = decryptIdentityValue(row.value, keys.encryptionKey)
  } catch (error) {
    return {
      ...base,
      format: 'stale-format',
      hashMatch: null,
      detail: `AES-GCM 解密失败（旧明文行 / 换过 USER_ID_ENCRYPTION_KEY）：${error instanceof Error ? error.message : String(error)}`,
      suggestion: seedSuggestion(userName),
    }
  }

  if (!looksLikeRegistrationRecord(plain)) {
    return {
      ...base,
      format: 'stale-format',
      hashMatch: null,
      detail: '解密成功但内容不是 base64url 的 OPAQUE 记录（格式漂移）',
      suggestion: seedSuggestion(userName),
    }
  }

  const expectedHash = hashIdentityValue(plain, keys.hashSalt)
  const hashMatch = row.valueHash !== null && expectedHash === row.valueHash

  return {
    ...base,
    format: 'ok',
    hashMatch,
    detail: hashMatch
      ? '密文可解，valueHash 一致'
      : '密文可解，但 valueHash 与解密后记录的盐化 HMAC 不一致',
    suggestion: hashMatch ? '—' : `重跑 seed 恢复 valueHash：${seedSuggestion(userName)}`,
  }
}

/** 一行是否需要让命令以非 0 退出（格式不可用或哈希不自洽） */
export function hasCredentialProblem(row: CredentialCheckRow): boolean {
  return row.format !== 'ok' || row.hashMatch === false
}

function hashMatchLabel(hashMatch: boolean | null): string {
  if (hashMatch === null) return '不可校验'
  return hashMatch ? '一致' : '不一致'
}

/** 探针表（纯函数，便于逐字断言；账号 / userId 之外不打印任何凭证内容） */
export function formatCredentialCheckReport(rows: readonly CredentialCheckRow[]): string[] {
  const header = ['账号', 'userId', '格式', 'valueHash', '建议']
  const body = rows.map((row) => [
    row.userName,
    row.userId,
    row.format,
    hashMatchLabel(row.hashMatch),
    row.suggestion,
  ])
  const widths = header.map((_, column) =>
    Math.max(header[column]!.length, ...body.map((cells) => cells[column]!.length)),
  )
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column]!)))
      .join('  ')
  const separator = widths.map((width) => '-'.repeat(width)).join('  ')
  return [render(header), separator, ...body.map(render)]
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseCredentialCheckArgs(process.argv.slice(2))
  const { target, envFile } = resolvePgTarget(
    repoRoot,
    opts.envFile === '' ? undefined : opts.envFile,
    opts.pgDbName,
  )
  const keys = readIdentityCryptoKeys(envFile)

  out(`目标 PG 库：${target.database}（env：${envFile}；只读探针，不写库）`)

  const pg = new Client(target)
  await pg.connect()
  let rows: CredentialCheckRow[]
  try {
    const result = await pg.query<{
      user_id: string
      user_name: string | null
      value: string | null
      value_hash: string | null
    }>(
      `SELECT i.user_id, u.user_name, i.value, i.value_hash
       FROM sys_user_identity i
       LEFT JOIN sys_user u ON u.id = i.user_id
       WHERE i.type = 'password'
       ORDER BY u.user_name NULLS LAST, i.user_id`,
    )
    rows = result.rows.map((row) =>
      analyzePasswordIdentity(
        {
          userName: row.user_name,
          userId: row.user_id,
          value: row.value,
          valueHash: row.value_hash,
        },
        keys,
      ),
    )
  } finally {
    await pg.end()
  }

  if (rows.length === 0) {
    line('warning', "库里没有任何 type='password' 的 sys_user_identity 行（新库还没建口令？）")
    return
  }

  for (const reportLine of formatCredentialCheckReport(rows)) out(reportLine)

  const stale = rows.filter((row) => row.format !== 'ok')
  const hashMismatch = rows.filter((row) => row.format === 'ok' && row.hashMatch === false)

  if (stale.length > 0 || hashMismatch.length > 0) {
    const parts: string[] = []
    if (stale.length > 0) parts.push(`${stale.length} 行格式不可用（旧明文 / 换过密钥 / 缺值）`)
    if (hashMismatch.length > 0) parts.push(`${hashMismatch.length} 行 valueHash 不一致`)
    throw new ViolationError(
      `口令凭证探针：${parts.join('；')}。` +
        '按上表「建议」列逐账号重跑 `pnpm walnut db:seed:pg --admin <账号> --password <新口令>`' +
        '（该命令写完会自验一次完整 OPAQUE 登录握手）。',
    )
  }

  line('ok', `口令凭证全部可用：${rows.length} 行（密文可解且 valueHash 一致；口令值不回显）`)
}
