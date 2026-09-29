import { Buffer } from 'node:buffer'
/**
 * `pnpm seed:pack` —— 把初始化数据打成**发版资产**。
 *
 * ## 为什么要有这一步
 *
 * 仓里那份 seed 是**轻量集**（8 个集合、不到 1MB）；行政区划（66 万条、89MB、gzip 后约 7.4MB）
 * 刻意不进 git —— 那种体量进历史会让每次 clone 与 diff 都陪葬。但它又是后端 `SharedAreaModule`
 * 要用的参考数据，所以它需要一个**随版本走**的出口：打成 tarball 挂在 GitHub Release 上，
 * 文件名带版本号 ⇒ 与 tag 对得上，谁装哪个版本就拿哪个资产。
 *
 * 包里两样东西：
 *
 * - `seed/`：仓里的初始化数据（与 `apps/server/db/seed/` 逐字一致）
 * - `areas.json.gz`：行政区划（**需要本机库里有 `shared_area`**，由 `--areas-from-db` 决定；
 *   没有就只打 seed 并明确提示）
 *
 * ## 为什么用 `tar` 而不是自己写压缩
 *
 * Node 没有内置 tar。`tar` 在 Windows 10+ 与所有 CI runner 上都是现成的（bsdtar / GNU tar），
 * 而它只做"打包"这一件事、没有版本敏感的行为。自己实现 tar 头才是真的风险。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { MongoClient } from 'mongodb'
import { PreconditionError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { stringifyCollectionFile } from './ejson.ts'
import { resolveConnection, SEED_DIR } from './seed.ts'

/** 产物目录（gitignore 掉的；别把 tarball 提交进仓） */
export const PACK_DIR = 'apps/server/db/.pack'

/** 资产文件名：**带版本号**，与 tag 对得上 */
export function assetName(version: string): string {
  return `walnut-admin-seed-${version}.tar.gz`
}

export function parsePackArgs(argv: readonly string[]): { areasFromDb: boolean, version?: string } {
  const opts = { areasFromDb: false, version: undefined as string | undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--areas-from-db')
      opts.areasFromDb = true
    else if (argv[i] === '--version')
      opts.version = argv[++i]
    else
      throw new PreconditionError(`未知参数 ${argv[i]}（支持 --areas-from-db / --version）`)
  }
  return opts
}

export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parsePackArgs(process.argv.slice(2))
  const version = opts.version ?? (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version

  const seedDir = resolve(repoRoot, SEED_DIR)
  if (!existsSync(seedDir))
    throw new PreconditionError(`找不到 ${SEED_DIR} —— 先确认仓是完整的`)

  const staging = resolve(repoRoot, PACK_DIR, 'staging')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, 'seed'), { recursive: true })
  // 用 Node 自己的 `cpSync`，别 shell 出去调 `cp` —— Windows 上没有它（实测会 ENOENT）
  cpSync(seedDir, join(staging, 'seed'), { recursive: true })

  let areasBytes = 0
  if (opts.areasFromDb) {
    const { uri, dbName } = resolveConnection(repoRoot, { envFile: '', dbName: undefined, uri: undefined })
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
    await client.connect()
    try {
      const docs = await client.db(dbName).collection('shared_area').find({}).sort({ _id: 1 }).toArray()
      if (docs.length === 0)
        throw new PreconditionError(`库里 ${dbName} 没有 shared_area 数据 —— 先 \`pnpm db:seed --with-areas <文件>\``)
      const gz = gzipSync(Buffer.from(stringifyCollectionFile(docs), 'utf8'), { level: 9 })
      writeFileSync(join(staging, 'areas.json.gz'), gz)
      areasBytes = gz.length
      out(`  行政区划 ${docs.length} 条 → areas.json.gz（${(gz.length / 1024 / 1024).toFixed(1)}MB）`)
    }
    finally {
      await client.close()
    }
  }
  else {
    out('  未带行政区划（加 --areas-from-db 且本机库里有 shared_area 时才会打进去）')
  }

  const assetPath = resolve(repoRoot, PACK_DIR, assetName(version))
  mkdirSync(resolve(repoRoot, PACK_DIR), { recursive: true })
  // `-C staging .`：让包内路径是 `seed/...` 与 `areas.json.gz`，而不是带上本机的绝对路径
  execFileSync('tar', ['-czf', assetPath, '-C', staging, '.'], { stdio: 'inherit' })
  rmSync(staging, { recursive: true, force: true })

  const size = statSync(assetPath).size
  out(`资产：${PACK_DIR}/${assetName(version)}（${(size / 1024 / 1024).toFixed(2)}MB${areasBytes > 0 ? '，含行政区划' : ''}）`)
  line('ok', '打包完成 —— 发版时用 `gh release upload <tag> <该文件>` 挂上去')
}
