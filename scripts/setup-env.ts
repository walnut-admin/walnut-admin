import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv, cwd, exit } from 'node:process'

// --- config ---

interface EnvEntry {
  /** app 目录名 */
  app: string
  /** 环境后缀: "development" | "production" | "stage" */
  env: string
}

const ROOT = cwd()
const KEYS_FILE = join(ROOT, '.env.keys')

/** 需要加密的文件清单（admin 的 base .env 不涉密，跳过） */
const ENTRIES: EnvEntry[] = [
  { app: 'admin', env: 'development' },
  { app: 'admin', env: 'production' },
  { app: 'admin', env: 'stage' },
  { app: 'server', env: 'development' },
  { app: 'server', env: 'production' },
  { app: 'server', env: 'stage' },
]

// --- helpers ---

function envFileName(entry: EnvEntry): string {
  return `.env.${entry.env}`
}

function encryptedPath(entry: EnvEntry): string {
  return join(ROOT, 'apps', entry.app, 'env-encrypted', envFileName(entry))
}

function localPath(entry: EnvEntry): string {
  return join(ROOT, 'apps', entry.app, 'env-local', envFileName(entry))
}

function dotenvxEncode(args: string[]): void {
  execSync(`npx dotenvx ${args.join(' ')}`, { stdio: 'inherit', cwd: ROOT })
}

// --- merge .env.keys ---

/**
 * dotenvx 对每个文件独立生成密钥，同名 key 会重复出现（admin + server 都有
 * .env.development）。读取 .env.keys 将同名 key 的值用逗号合并，写回。
 */
function mergeKeysFile(): void {
  if (!existsSync(KEYS_FILE))
    return

  const raw = readFileSync(KEYS_FILE, 'utf-8')
  const lines = raw.split('\n')

  // 保留 header（以 # 或空行开头的注释块）
  const header: string[] = []
  const body = new Map<string, string[]>()
  let headerEnded = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!headerEnded && (trimmed.startsWith('#') || trimmed === '' || trimmed.startsWith('!'))) {
      header.push(line)
      continue
    }
    headerEnded = true

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1 || trimmed === '')
      continue

    const name = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '')

    if (!body.has(name))
      body.set(name, [])
    body.get(name)!.push(value)
  }

  // 重建文件：header + 去重合并后的 key
  const merged: string[] = [...header]
  for (const [name, values] of body) {
    const unique = [...new Set(values)]
    merged.push(unique.length === 1
      ? `${name}=${unique[0]}`
      : `${name}="${unique.join(',')}"`)
  }

  writeFileSync(KEYS_FILE, `${merged.join('\n')}\n`)
}

// --- commands ---

function doEncrypt(): void {
  if (!existsSync(KEYS_FILE)) {
    console.error('❌ 未找到 .env.keys，请先运行一次 dotenvx encrypt 生成密钥对')
    exit(1)
  }

  for (const entry of ENTRIES) {
    const src = localPath(entry)
    const dest = encryptedPath(entry)

    if (!existsSync(src)) {
      console.warn(`⚠  跳过 ${entry.app}/.env.${entry.env}：env-local 源文件不存在`)
      continue
    }

    mkdirSync(join(ROOT, 'apps', entry.app, 'env-encrypted'), { recursive: true })

    console.log(`🔒 加密 ${entry.app}/.env.${entry.env} → env-encrypted/`)
    cpSync(src, dest)
    dotenvxEncode(['encrypt', '-f', dest, '-fk', KEYS_FILE])
  }

  mergeKeysFile()
  console.log('✅ 加密完成，请提交 env-encrypted/ 到 Git')
}

/**
 * dotenvx decrypt 会在文件头部保留 DOTENV_PUBLIC_KEY 元数据（7 行），
 * 去掉它们以免被当作环境变量解析。
 */
function stripPublicKeyHeader(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  // 跳过 header 直到第一个真实环境变量（不以 # 或 DOTENV_PUBLIC 开头）
  let start = 0
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t && !t.startsWith('#') && !t.startsWith('DOTENV_PUBLIC_KEY')) {
      start = i
      break
    }
  }
  writeFileSync(filePath, `${lines.slice(start).join('\n').trim()}\n`)
}

function doDecrypt(): void {
  if (!existsSync(KEYS_FILE)) {
    console.error('❌ 未找到 .env.keys，请先从 1Password 获取私钥文件')
    exit(1)
  }

  for (const entry of ENTRIES) {
    const src = encryptedPath(entry)
    const dest = localPath(entry)

    if (!existsSync(src)) {
      console.warn(`⚠  跳过 ${entry.app}/.env.${entry.env}：env-encrypted 源文件不存在`)
      continue
    }

    mkdirSync(join(ROOT, 'apps', entry.app, 'env-local'), { recursive: true })

    console.log(`🔓 解密 ${entry.app}/.env.${entry.env} → env-local/`)
    cpSync(src, dest)
    dotenvxEncode(['decrypt', '-f', dest, '-fk', KEYS_FILE])
    stripPublicKeyHeader(dest)
  }

  console.log('✅ 解密完成')
}

// --- main ---

const command = argv[2]

switch (command) {
  case 'decrypt': {
    doDecrypt()
    break
  }
  case 'encrypt': {
    doEncrypt()
    break
  }
  default: {
    console.log([
      '用法: tsx scripts/setup-env.ts <decrypt|encrypt>',
      '  decrypt  — 从 env-encrypted/ 解密到 env-local/（新成员初始化）',
      '  encrypt  — 从 env-local/ 加密到 env-encrypted/（更新密钥后）',
    ].join('\n'))
    exit(1)
  }
}
