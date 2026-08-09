import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * 需要加密的文件清单。
 * admin 的基础 .env（env: ''，无环境后缀）存放构建必填的 VITE_* 变量
 * （VITE_APP_TITLE 等），必须随仓库加密分发，否则 CI 构建取不到。
 */
const ENTRIES: EnvEntry[] = [
  { app: 'admin', env: '' },
  { app: 'admin', env: 'development' },
  { app: 'admin', env: 'production' },
  { app: 'admin', env: 'stage' },
  { app: 'server', env: 'development' },
  { app: 'server', env: 'production' },
  { app: 'server', env: 'stage' },
]

// --- helpers ---

function envFileName(entry: EnvEntry): string {
  return entry.env ? `.env.${entry.env}` : '.env'
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

/** 静默执行 dotenvx（不向 stdout 输出解密内容），失败抛错 */
function dotenvxQuiet(args: string[]): void {
  execSync(`npx dotenvx ${args.join(' ')}`, { stdio: 'pipe', cwd: ROOT })
}

// --- rebuild .env.keys ---

/**
 * dotenvx encrypt 对每个文件生成全新密钥并追加进 keys 文件，同名 env 会重复出现
 * （admin + server 都有 .env.development）。读取临时 keys 文件，按环境名分组、
 * 逗号合并去重，重建规范的 .env.keys（每环境一行，admin 在前 server 在后）。
 */
function rebuildKeysFile(tmpKeysPath: string): string {
  const banner: string[] = []
  const byEnv = new Map<string, string[]>()
  let bannerEnded = false

  for (const line of readFileSync(tmpKeysPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    // banner 以 #/ 开头（dotenvx 生成的固定头），# .env.* 是文件注释，不算 banner
    if (!bannerEnded && (trimmed.startsWith('#/') || trimmed === '')) {
      banner.push(line)
      continue
    }
    bannerEnded = true

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1 || trimmed === '')
      continue

    // 基础 .env 的 key 名是 DOTENV_PRIVATE_KEY（无环境后缀），带后缀的如
    // DOTENV_PRIVATE_KEY_PRODUCTION → envName = 'PRODUCTION'，无后缀 → ''
    const rawName = line.slice(0, eqIdx).trim()
    const envName = rawName.replace('DOTENV_PRIVATE_KEY', '').replace(/^_/, '')
    const value = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '')
    const keys = byEnv.get(envName) ?? []
    for (const k of value.split(',')) {
      if (k && !keys.includes(k))
        keys.push(k)
    }
    byEnv.set(envName, keys)
  }

  const body = [...byEnv.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([envName, keys]) => {
      const fileSuffix = envName ? `.${envName.toLowerCase()}` : ''
      const keySuffix = envName ? `_${envName}` : ''
      return `# .env${fileSuffix}\nDOTENV_PRIVATE_KEY${keySuffix}="${keys.join(',')}"`
    })
    .join('\n')

  return `${banner.join('\n')}\n${body}\n`
}

// --- commands ---

function doEncrypt(): void {
  // 1. 前置校验：全部源文件必须存在。缺任何一个就中止，
  //    避免部分文件换新密钥后 keys 文件不完整
  const missing = ENTRIES.filter(entry => !existsSync(localPath(entry)))
  if (missing.length > 0) {
    console.error(`❌ 以下 env-local 源文件缺失，中止加密：${missing.map(e => `${e.app}/${envFileName(e)}`).join(', ')}`)
    exit(1)
  }

  // 2. 在临时目录加密全部文件：dotenvx 对每个文件生成全新密钥并追加进临时
  //    keys 文件。期间不触碰 env-encrypted/ 与 .env.keys，任一步失败可整体放弃
  const tmpDir = mkdtempSync(join(tmpdir(), 'walnut-encrypt-'))
  const tmpKeys = join(tmpDir, '.env.keys.tmp')
  const staged: Array<{ entry: EnvEntry, dest: string }> = []

  try {
    for (const entry of ENTRIES) {
      const src = localPath(entry)
      const dest = join(tmpDir, entry.app, envFileName(entry))
      mkdirSync(join(tmpDir, entry.app), { recursive: true })
      cpSync(src, dest)
      console.log(`🔒 加密 ${entry.app}/${envFileName(entry)}`)
      dotenvxEncode(['encrypt', '-f', dest, '-fk', tmpKeys])
      staged.push({ entry, dest })
    }

    // 3. 校验：在密文的独立副本上验证可解密——dotenvx decrypt 会原地解密，
    //    直接对 staged 文件解密会把密文变成明文（曾导致明文被提交的严重事故），
    //    校验后再断言 staged 文件仍是密文
    for (const { entry, dest } of staged) {
      const checkDest = join(tmpDir, `check-${entry.app}-${entry.env || 'base'}`)
      cpSync(dest, checkDest)
      try {
        dotenvxQuiet(['decrypt', '-f', checkDest, '-fk', tmpKeys])
      }
      catch {
        throw new Error(`密钥校验失败：${entry.app}/${envFileName(entry)} 无法解密，已中止（未改动任何文件）`)
      }
      if (!readFileSync(dest, 'utf-8').includes('encrypted:')) {
        throw new Error(`密文完整性检查失败：${entry.app}/${envFileName(entry)} 不含 encrypted: 前缀，已中止（未改动任何文件）`)
      }
    }

    // 4. 从临时 keys 重建正式 .env.keys（每环境一行、逗号合并，旧密钥全部作废）
    const fresh = rebuildKeysFile(tmpKeys)
    writeFileSync(KEYS_FILE, fresh)

    // 5. 提交：临时密文覆盖 env-encrypted/
    for (const { entry, dest } of staged) {
      mkdirSync(join(ROOT, 'apps', entry.app, 'env-encrypted'), { recursive: true })
      cpSync(dest, encryptedPath(entry))
    }

    const keyLines = fresh.split('\n').filter(l => l.startsWith('DOTENV_PRIVATE_KEY'))
    const keyCounts = keyLines.map(l => l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').split(',').length)
    console.log(`✅ 加密完成：env-encrypted/ 已更新，.env.keys 已重新生成（${keyLines.length} 行，每行 ${keyCounts.join('/')} 个 key）`)
    console.log('⚠  旧密钥已全部作废，请将新 .env.keys 同步到 1Password，并提交 env-encrypted/ 到 Git')
  }
  catch (e) {
    console.error(`❌ ${(e as Error).message}`)
    exit(1)
  }
  finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
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
      console.warn(`⚠  跳过 ${entry.app}/${envFileName(entry)}：env-encrypted 源文件不存在`)
      continue
    }

    mkdirSync(join(ROOT, 'apps', entry.app, 'env-local'), { recursive: true })

    console.log(`🔓 解密 ${entry.app}/${envFileName(entry)} → env-local/`)
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
