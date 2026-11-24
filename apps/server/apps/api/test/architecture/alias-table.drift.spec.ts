import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SERVER_ROOT } from './module-graph'

/**
 * 路径别名表的漂移守卫：`apps/server/tsconfig.json` 的 `compilerOptions.paths` 是**唯一真源**，
 * `infra/swc/{dev,stage,prod}.swcrc` 的 `jsc.paths` 是同一张表的三份手抄副本。
 * 四份表互不联动：抄错一份，`tsc` / lint / 单测全都不报，只在对应环境的产物里表现为
 * 别名解析不到（或指到别的目录）。
 *
 * ① 真源是 server tsconfig 的 `compilerOptions.paths`。tsc（类型检查）与 SWC（`nest build` 的
 *    转译）各读各的表，所以三份 swcrc 都要与它逐键对账。
 * ② 比对前把**两侧**每个值的前导 `./` 剥掉（只剥一个）。dev.swcrc 的值从合并提交 `b63ec42a`
 *    起就全部没有 `./` 前缀，在 `jsc.baseUrl: "."` 下语义等价；而 `scaffold:lib` 给 swcrc 插入的
 *    也正是无 `./` 形态（`tooling/scripts/src/scaffold/lib-registration.ts` 的 `insertSwcPaths`）——
 *    严格逐字断言会被脚手架自己打红。
 * ③ 与 `lib-registration.drift.spec.ts` ①③ 的分工：那边守 `@walnut-server/<lib>` 的**键集合
 *    ≡ 磁盘 libs** 与根别名的值；本文件守它没管的面 —— `@/*`、swcrc 的 `/*` 变体值、不属于
 *    `@walnut-server/<lib>` 的外来别名，以及四份表的**键序**。两边都红是 lib 注册问题；只这边红
 *    是 alias 表被抄错。
 * ④ 不守 `outDir`：产物目录归 `pnpm walnut lint:turbo-cache`（它顺 `tsConfigPath` 解析 outDir）。
 * ⑤ `build/image/server/infra/swc/*.swcrc` 是 `.gitignore`（`build/image/`）下的镜像 staging 副本，
 *    由构建脚本生成，**不是第五张手抄表**，本文件不读它。
 */

const TSCONFIG_FILE = 'tsconfig.json'
const SWCRC_FILES = ['infra/swc/dev.swcrc', 'infra/swc/prod.swcrc', 'infra/swc/stage.swcrc'] as const

type PathsTable = Record<string, string[]>

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(SERVER_ROOT, relativePath), 'utf8')) as T
}

function readTsconfigPaths(): PathsTable {
  return readJson<{ compilerOptions: { paths: PathsTable } }>(TSCONFIG_FILE).compilerOptions.paths
}

function readSwcPaths(file: string): PathsTable {
  return readJson<{ jsc: { paths: PathsTable } }>(file).jsc.paths
}

/** 剥掉值的前导 `./`（只剥一个）：tsconfig 写 `./libs/x/src`，swcrc 可能写 `libs/x/src` */
function normalizeTargets(targets: readonly string[]): string[] {
  return targets.map(target => target.replace(/^\.\//, ''))
}

/**
 * 逐键对账（纯函数；自测用合成对象跑同一套判定，证明它不是空转），返回问题行：
 * 缺键 / 多键 / 值不一致（带两侧原始数组）/ 键序不同。键序只在键集合相等时比 ——
 * 否则「少一个键导致后面全部错位」会淹没在键序噪音里。
 */
function collectProblems(ref: PathsTable, cand: PathsTable): string[] {
  const problems: string[] = []
  const refKeys = Object.keys(ref)
  const candKeys = Object.keys(cand)

  const missing = refKeys.filter(key => !(key in cand))
  if (missing.length > 0)
    problems.push(`缺键 ${missing.length} 个：[${missing.join(', ')}]`)

  const extra = candKeys.filter(key => !(key in ref))
  if (extra.length > 0)
    problems.push(`多键 ${extra.length} 个（真源里没有）：[${extra.join(', ')}]`)

  for (const key of refKeys) {
    if (!(key in cand))
      continue
    const expected = normalizeTargets(ref[key])
    const actual = normalizeTargets(cand[key])
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      problems.push(`键 "${key}" 的值不一致：真源 [${ref[key].join(', ')}]，候选 [${cand[key].join(', ')}]`)
  }

  if (missing.length === 0 && extra.length === 0) {
    const firstDiff = refKeys.findIndex((key, index) => key !== candKeys[index])
    if (firstDiff >= 0) {
      problems.push(
        `键序不同：第 ${firstDiff + 1} 个键真源是 "${refKeys[firstDiff]}"，候选是 "${candKeys[firstDiff]}"`,
      )
    }
  }

  return problems
}

describe('路径别名表漂移：tsconfig 为真源，三份 swcrc 逐键对账', () => {
  it('tsconfig 的 paths 至少 65 条（2026-11-24 实测地板；libs 只增不减，是地板不是等号）且含 @/* 键', () => {
    const ref = readTsconfigPaths()
    expect(Object.keys(ref).length).toBeGreaterThanOrEqual(65)
    expect(Object.keys(ref)).toContain('@/*')
  })

  it.each(SWCRC_FILES)('%s 的 paths 与 tsconfig 逐键一致（归一化前导 ./，键序一致）', (file) => {
    expect(collectProblems(readTsconfigPaths(), readSwcPaths(file))).toEqual([])
  })

  it('自测：缺键 / 多键 / 改值 / 改序四类都被 collectProblems 抓到（证明对账非空转）', () => {
    const ref: PathsTable = {
      '@/*': ['./apps/api/src/*'],
      '@walnut-server/const': ['./libs/const/src'],
      '@walnut-server/const/*': ['./libs/const/src/*'],
    }

    const withoutKey = (table: PathsTable, key: string): PathsTable => {
      const copy = { ...table }
      delete copy[key]
      return copy
    }

    // 正例：原样表、以及只剩「无 ./ 形态」的表都必须判绿（证明归一化两侧而非只归一化一侧）
    expect(collectProblems(ref, { ...ref })).toEqual([])
    expect(collectProblems(
      ref,
      Object.fromEntries(Object.entries(ref).map(([key, targets]) => [key, normalizeTargets(targets)])),
    )).toEqual([])

    const missing = collectProblems(ref, withoutKey(ref, '@walnut-server/const/*')).join('\n')
    expect(missing).toContain('缺键')
    expect(missing).toContain('@walnut-server/const/*')
    expect(missing).not.toContain('键序不同')

    const extra = collectProblems(ref, { ...ref, '@walnut-server/zzz': ['libs/zzz/src'] }).join('\n')
    expect(extra).toContain('多键')
    expect(extra).toContain('@walnut-server/zzz')
    expect(extra).not.toContain('键序不同')

    const changed = collectProblems(ref, { ...ref, '@/*': ['./apps/api/src2/*'] }).join('\n')
    expect(changed).toContain('值不一致')
    expect(changed).toContain('./apps/api/src2/*')

    const reordered = collectProblems(
      ref,
      Object.fromEntries(Object.entries(ref).reverse()),
    ).join('\n')
    expect(reordered).toContain('键序不同')
    expect(reordered).not.toContain('缺键')
    expect(reordered).not.toContain('多键')
  })

  it('三份 swcrc 的键序彼此一致（两两比对）', () => {
    const tables = SWCRC_FILES.map(file => ({ file, keys: Object.keys(readSwcPaths(file)) }))

    for (let left = 0; left < tables.length; left++) {
      for (let right = left + 1; right < tables.length; right++) {
        expect(
          tables[left].keys,
          `${tables[left].file} 与 ${tables[right].file} 的键序`,
        ).toEqual(tables[right].keys)
      }
    }
  })
})
