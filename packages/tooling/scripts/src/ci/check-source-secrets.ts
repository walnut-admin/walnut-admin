/**
 * **源码侧**密钥形态门禁：仓库里的文本文件不许出现凭据形状的串。
 *
 * ## 它为什么必须存在（这是被真实事故逼出来的）
 *
 * 2026-09-23，`check-dist-secrets`（产物侧）已经把「产物里有没有机密」看住了，
 * 但**没有任何东西扫源码与夹具**。于是我在一个测试夹具里写了腾讯云文档上那个样本 SecretId
 * （`AKID` + 32 位），当时 14 段 prepush 门禁 + 300 多个用例**全绿**，直到 `git push` 被
 * **GitHub 服务端的 push protection** 拦下 —— 整条 push 被拒：
 *
 * ```text
 * remote:  Push cannot contain secrets
 * remote:    - commit: …  path: packages/tooling/scripts/src/ci/__tests__/check-dist-secrets.test.ts
 * remote:       —— Tencent Cloud Secret ID ——
 * ```
 *
 * 三点教训，直接决定了这道门禁的形态：
 *   1. **服务端那道闸在 CI 之前**：本地门禁全绿也照样推不上去 ⇒ 必须在 **prepush** 里拦，
 *      只在 CI 里拦等于没有（那时 push 已经被拒了）。
 *   2. **它只认形状，分不出样本与真货**：所以本仓的规矩是「**假样本也不许长成真凭据的形状**」
 *      —— 夹具请**运行时拼装**（见 `check-dist-secrets.test.ts` 顶部的写法），
 *      **不要**往门禁里加白名单。
 *   3. **规则表必须是同一份**：源码侧另立一套必然与产物侧漂移。这里直接复用
 *      `check-dist-secrets` 的 `scanText`，于是「两边同源」不再是一句口号。
 *
 * ## 与产物侧的两个差别
 *
 * | | 产物侧（`lint:dist`） | 源码侧（这里） |
 * |---|---|---|
 * | 扫描面 | `apps/admin/dist` 里的文本产物 | `git ls-files` **∪ 未跟踪且未被忽略** 的文本文件 |
 * | 什么时候跑 | 构建之后（CI 的 build job） | **推送前**（`pnpm prepush`）+ CI |
 * | 为什么 | 产物是**公开文件** | 仓库（尤其**公开仓**）与服务端扫描 |
 *
 * 用 `lsFilesWithUntracked` 而不是只看跟踪面：**新写的夹具文件还没 `git add` 就该被扫到** ——
 * 这道门禁的价值全在"在 push 之前"，漏掉未跟踪文件等于漏掉刚写下的那一份。
 *
 * ## 判据刻意宽松的地方（宁可漏报不可误报）
 *
 * - 与产物侧共用同一份收窄过的规则表（例：连接串的口令必须"像真口令"——长度 ≥ 8 且含非数字；
 *   实测这一条把文档里的格式说明与本地容器默认口令那 4 处误报全挡掉了）。
 * - 只扫**文本后缀**；二进制（图片、字体、`.br`/`.gz`）不读。
 * - 超过 `MAX_FILE_BYTES` 的文件跳过并**在输出里报出条数** —— 静默跳过是最容易变成假绿的地方。
 * - 不扫 `.gitignore` 覆盖的东西（`env-local/` 正是靠这个被排除的：它本来就是明文 env，
 *   但**不入库**，所以不该按"仓库里的凭据"报）。
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { lsFilesWithUntracked } from '../lib/git.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { lineOf, scanText } from './check-dist-secrets.ts'

/**
 * 源码侧要扫的后缀。
 *
 * 比产物侧的 `TEXT_FILE` 宽得多，因为这里扫的是**仓库**：`.ts` / `.vue` / `.md` / `.yaml`
 * 都是凭据最容易落脚的地方（实测：我那次翻车就落在 `.ts`，而产物侧的后缀表里根本没有 `.ts`）。
 */
export const SOURCE_TEXT_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx|vue|md|markdown|json|json5|jsonc|yaml|yml|toml|ini|conf|cfg|sh|bash|ps1|sql|txt|xml|svg|html|htm|css|scss|sass|less|env|example|properties|pem|key|pub|lock)$/i

/** 单文件上限：超过就跳过（并在输出里报出来，不静默） */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export interface SourceFinding {
  rule: string
  file: string
  /** 1-based 行号 */
  line: number
  detail: string
}

export interface SourceScanResult {
  findings: SourceFinding[]
  /** 实际读了的文本文件数 */
  scanned: number
  /** 因超过上限跳过的文件（相对路径） */
  skippedTooLarge: string[]
  /** 命令行总数（用于打印扫描面） */
  total: number
}

/** 扫一份文本内容（拆出来便于用例直接喂字符串）；结果**按行号排序**，读起来是从上到下 */
export function scanSourceText(text: string, file: string): SourceFinding[] {
  return scanText(text, file)
    .map(f => ({
      rule: f.rule,
      file,
      line: lineOf(text, f.index ?? 0),
      detail: f.detail,
    }))
    .sort((a, b) => a.line - b.line)
}

/** 扫整个工作区（跟踪面 ∪ 未跟踪且未被忽略） */
export function collectFindings(cwd = REPO_ROOT): SourceScanResult {
  const all = lsFilesWithUntracked('*')
  const findings: SourceFinding[] = []
  const skippedTooLarge: string[] = []
  let scanned = 0

  for (const rel of all) {
    if (!SOURCE_TEXT_FILE.test(rel))
      continue
    const abs = join(cwd, rel)
    let size: number
    try {
      size = statSync(abs).size
    }
    catch {
      continue // 索引里有、盘上没了（比如刚删还没 add 的）—— 不当成扫描面
    }
    if (size > MAX_FILE_BYTES) {
      skippedTooLarge.push(rel)
      continue
    }
    scanned++
    findings.push(...scanSourceText(readFileSync(abs, 'utf8'), rel))
  }

  return { findings, scanned, skippedTooLarge, total: all.length }
}

export function main(): void {
  let result: SourceScanResult
  try {
    result = collectFindings()
  }
  catch (e) {
    throw new PreconditionError(`拿不到仓库文件清单（git ls-files 失败）：${(e as Error).message}`)
  }

  out(`源码密钥形态体检：${result.scanned} / ${result.total} 个文件（跟踪面 ∪ 未跟踪未被忽略，只读文本后缀）`)
  if (result.skippedTooLarge.length > 0)
    lineErr('warning', ` 跳过了 ${result.skippedTooLarge.length} 个超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB 的文件：${result.skippedTooLarge.join(', ')}`)

  if (result.findings.length === 0) {
    line('ok', '没有凭据形状的串（PEM 私钥 / 带真口令的连接串 / JWT / 云厂商 AK）。')
    out('   提示：GitHub 的 push protection 在**服务端**跑，它只认形状、分不出样本与真货。')
    out('   所以测试夹具请**运行时拼装**（把前缀与值分开拼，别写成连续字面量），**不要**往这里加白名单。')
    return
  }

  lineErr('violation', `有 ${result.findings.length} 处凭据形状的串 —— 服务端 push protection 会用同样的判据拒掉整条 push：\n`)
  for (const f of result.findings)
    err(`  ${f.file}:${f.line}  [${f.rule}] ${f.detail}`)
  err('\n修法（按优先级）：')
  err('  ① 如果是**真凭据**：先轮换它，再从历史里删掉（改完的提交用 rebase 重写，别只删最新那版）。')
  err(`  ② 如果是**夹具**：把它**拼出来**，别写字面量 —— 前缀与值分开拼即可（见 check-dist-secrets.test.ts 顶部）。`)
  err('  ③ 如果是**文档里的格式说明**：写成不带 scheme 前缀的形状（如「连接串里的 `user:pass@`」）。')
  err('  ⚠️ 不要走"加白名单"这条路：那道服务端的闸不会读我们的白名单。')
  throw new ViolationError(`源码里有 ${result.findings.length} 处凭据形状的串（明细见上）`)
}
