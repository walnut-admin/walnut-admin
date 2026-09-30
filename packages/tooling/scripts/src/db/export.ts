/**
 * `pnpm db:export` —— 从库反向导出 `apps/server/db/seed/`（让 seed 数据"可再生成"）。
 *
 * ## 为什么必须成对存在
 *
 * 只有"播种"没有"导出"时，仓里那份数据就是**某次手工导出的快照**：没人知道它还能不能从库里
 * 再生成一遍，也没人敢保证它与当前 schema/数据一致。有了反向导出，`git diff` 就成了判据 ——
 * 「仓是唯一真源」这句话才成立。
 *
 * ## 两个刻意的约束
 *
 * 1. **导出哪些集合 = 仓里有哪些集合**（`apps/server/db/seed/*.json` 的文件名列表，可用 `--only` 收窄）。
 *    不按库里有什么就导什么 —— 否则 `sys_device` 之类的运行时状态、`app_key` 这种密钥表会被
 *    下一次导出顺手带进仓。
 * 2. **文档按 `_id` 排序**。库的自然顺序不保证稳定，不排序的话每次导出的 diff 都是全文件重排，
 *    那种 diff 没人能审。
 *
 * 裁剪规则见 `policy.ts`（两个方向共用一份，否则两边永远对不上）。
 */
import type { Db, Document } from 'mongodb'
import type { SeedOptions } from './seed.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { PreconditionError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { anonymizeDocs } from './anonymize.ts'
import { stringifyCollectionFile } from './ejson.ts'
import { applyPolicy } from './policy.ts'
import { listSeedCollections, parseArgs, resolveConnection, resolvePath } from './seed.ts'

/** 解析 argv（导出侧的参数；与播种共用同一套口径，靠 `mode` 挡住不属于本方向的参数） */
export function parseExportArgs(argv: readonly string[]): SeedOptions {
  return parseArgs(argv, 'export')
}

/** 一个集合导出为字符串（排序 + 套策略 + 可选脱敏），返回文档条数 */
export async function exportCollection(
  db: Db,
  name: string,
  anonymize = false,
): Promise<{ text: string, count: number }> {
  // 按 `_id` 升序：`ObjectId` 的序与插入序一致，稳定且人可读；这也是唯一能压住 diff 噪声的排序键
  const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray() as Document[]
  const curated = applyPolicy(name, docs as Record<string, unknown>[])
  // 脱敏在裁剪**之后**：先决定这份快照要哪些数据，再把个人数据掩掉
  const final = anonymize ? anonymizeDocs(curated) : curated
  return { text: stringifyCollectionFile(final), count: final.length }
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseExportArgs(process.argv.slice(2))
  const { uri, dbName } = resolveConnection(repoRoot, opts)

  const sourceDir = resolvePath(repoRoot, opts.seedDir)
  const collections = listSeedCollections(sourceDir).filter(c => opts.only === undefined || opts.only.includes(c))
  if (collections.length === 0)
    throw new PreconditionError(`没有可导出的集合（${sourceDir} 里没有 .json）`)

  const outDir = resolvePath(repoRoot, opts.outDir)
  // 脱敏是**有损**的（原值被掩掉），所以它永远不该写回仓内 seed —— 那会把唯一真源变成一份掩码快照。
  // 要求显式给一个 `--out`，让"这次导出是排障快照"变成一个看得见的动作。
  if (opts.anonymize && resolvePath(repoRoot, opts.outDir) === resolvePath(repoRoot, opts.seedDir)) {
    throw new PreconditionError(
      '脱敏导出必须用 --out 指定一个**别的**目录（例如 --out tmp/prod-snapshot）——'
      + ' 脱敏是有损的，别让掩码快照覆盖仓内 seed',
    )
  }
  mkdirSync(outDir, { recursive: true })

  out(`导出集合：${collections.length} 个（按仓内文件名清单）`)
  out(`目标目录：${opts.outDir}`)

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  try {
    const db = client.db(dbName)
    for (const name of collections) {
      const { text, count } = await exportCollection(db, name, opts.anonymize)
      writeFileSync(join(outDir, `${name}.json`), text)
      out(`  ${name.padEnd(16)} ${String(count).padStart(6)} 条`)
    }

    if (opts.areas !== undefined) {
      const { text, count } = await exportCollection(db, 'shared_area')
      const target = resolvePath(repoRoot, opts.areas)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      out(`  shared_area（另存）  ${String(count).padStart(6)} 条 -> ${opts.areas}`)
    }

    line('ok', `导出完成：${collections.length} 个集合`)
  }
  finally {
    await client.close()
  }
}
