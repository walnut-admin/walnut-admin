/**
 * `pnpm-workspace.yaml` 的 `catalog:` ↔ `pnpm-lock.yaml` 的锁步体检。
 *
 * ## 它防的是哪一种失败
 *
 * 「升级一个依赖」在本仓的正常动作是**改 `pnpm-workspace.yaml` 里 catalog 的一行**
 * （`catalogMode: strict` 下这是唯一的入口）。若只提交了 catalog 那一行、**没带上锁文件的更新**：
 * 本地一切正常，CI 却死在 `pnpm install --frozen-lockfile`，而且 pnpm 的报错**不会告诉你是哪一条**
 * （它只说 lockfile 不是最新的）。
 *
 * ## ⚠️ 为什么必须比 **HEAD 里那一对**，而不是工作区
 *
 * 这是本门禁最容易做错、也最容易做成「恒关」的地方。实测（2026-09-23）：
 * **pnpm 12 默认会在跑任何脚本之前自动 install**（`verifyDepsBeforeRun` 未设置时的默认行为）。
 * 于是：
 *
 * | 调用路径 | 能看到不一致吗 |
 * |---|---|
 * | `pnpm lint:lockfile`（prepush / CI / 发版电池走的都是这条） | ❌ **看不到** —— pnpm 先把锁文件改对了才轮到门禁 |
 * | `node bin/check-catalog-lockstep.ts`（绕过 pnpm） | ✅ 看得到 |
 *
 * 也就是说：只看工作区的话，这段门禁**永远绿**，属于「恒关的门禁 = 没有门禁」。
 * 而 `git show HEAD:…` 拿到的是**即将被 CI 检出的那一对**，与 pnpm 的自动 install 无关
 * —— 这才是 CI 真正会炸的那个组合。
 *
 * ## 为什么只比 `catalogs:` 段，不去解析 importers
 *
 * pnpm 12 的锁文件是**两段式 YAML**：第一段是根桩（`importers` 里只有 `.`），真正的数据在第二段
 * （本仓 `catalogs:` 在 165 行、第二段 `importers:` 在 897 行）。而第二段的
 * `catalogs.default.<包名>` 里 pnpm 自己记了 `specifier`（= 声明值）与 `version`（= 解析值）
 * —— 拿它跟 `pnpm-workspace.yaml` 一比就是答案，不必啃 1 MB 的 `importers`。实测 16ms。
 *
 * ## 判据刻意宽松的地方（宁可漏报不可误报）
 *
 * `version` 那条只对**看起来是精确版本**的声明生效：声明里带 `^` `~` `>` `<` `*` `|` 或 `x`
 * 时跳过版本比对（那种情况解析值与声明值本来就不该相等，比了必误报）。本仓 `saveExact: true`，
 * 243 条全是精确版本，所以这条宽松目前是纯保险。
 */
import { execFileSync } from 'node:child_process'

import { REPO_ROOT } from '../lib/repo-root.ts'

export interface Finding {
  rule: string
  detail: string
}

export interface CatalogLockstep {
  declared: Map<string, string>
  locked: Map<string, { specifier?: string, version?: string }>
}

/** 取一个顶层键的正文行（到下一个顶层键为止），返回 `[起始行号(1-based), 行数组]` */
export function topLevelSection(text: string, key: string, which: 'first' | 'last' = 'first'): { startLine: number, lines: string[] } | null {
  const lines = text.split('\n')
  const hits = lines.map((l, i) => (l.startsWith(`${key}:`) ? i : -1)).filter(i => i >= 0)
  if (hits.length === 0)
    return null
  const start = which === 'last' ? hits[hits.length - 1]! : hits[0]!
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return { startLine: start + 2, lines: lines.slice(start + 1, end) }
}

const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '')

/**
 * 拆 `  键: 值` 形态的行。
 *
 * 手写而不是一条正则打到底：`\s*(.+?)\s*$` 这类写法会被
 * `regexp/no-super-linear-backtracking` 判为可多项式回溯（本仓已有先例）。
 * 返回 `null` 表示这一行不是「两个空格缩进的键值对」。
 */
function splitIndentedKV(line: string, indent: number): { key: string, value: string } | null {
  if (line.length <= indent)
    return null
  const pad = ' '.repeat(indent)
  if (!line.startsWith(pad))
    return null
  const body = line.slice(indent)
  const head = body[0]!
  if (head === ' ' || head === '#' || head === '-')
    return null
  // 键到第一个冒号为止（值里也可能有冒号，所以只切第一个）
  const colon = body.indexOf(':')
  if (colon <= 0)
    return null
  return { key: body.slice(0, colon), value: body.slice(colon + 1).trim() }
}

/** `pnpm-workspace.yaml` 的 `catalog:` → 包名到声明值 */
export function parseDeclaredCatalog(workspaceYaml: string): Map<string, string> {
  const sec = topLevelSection(workspaceYaml, 'catalog')
  const out = new Map<string, string>()
  if (!sec)
    return out
  for (const l of sec.lines) {
    const kv = splitIndentedKV(l, 2)
    // ⚠️ 名字必须**剥引号**：catalog 里 `'@scope/name': 1.0.0` 是常见写法。
    // 不剥会与锁文件那侧（已剥）对不上 —— 实测 243 条里会误报 97 条。
    if (kv && kv.value !== '')
      out.set(unquote(kv.key), kv.value)
  }
  return out
}

/** 锁文件**第二段**的 `catalogs.default.<包名>.{specifier,version}` */
export function parseLockedCatalog(lockfile: string): Map<string, { specifier?: string, version?: string }> {
  // 取**最后**一次出现的 `catalogs:` —— 两段式锁文件里只有第二段是真的
  const sec = topLevelSection(lockfile, 'catalogs', 'last')
  const out = new Map<string, { specifier?: string, version?: string }>()
  if (!sec)
    return out
  let cur: string | null = null
  for (const l of sec.lines) {
    // `  default:`（本仓只有默认 catalog；named catalog 出现时这里会重置，属可接受的漏报）
    if (splitIndentedKV(l, 4) === null && /^ {2}\S/.test(l)) {
      cur = null
      continue
    }
    const named = splitIndentedKV(l, 4)
    if (named && named.value === '') {
      cur = unquote(named.key)
      out.set(cur, {})
      continue
    }
    const kv = splitIndentedKV(l, 6)
    if (kv && cur && (kv.key === 'specifier' || kv.key === 'version'))
      out.get(cur)![kv.key] = unquote(kv.value)
  }
  return out
}

/** 声明值是精确版本吗（带范围符的跳过版本比对，见文件头「判据刻意宽松」） */
export function isExactVersion(v: string): boolean {
  return !/[\^~><*|]|\bx\b/i.test(v)
}

/** 纯函数：两份文本 → 发现列表（与 IO、git 无关，便于单测） */
export function compareCatalogs(workspaceYaml: string, lockfile: string): Finding[] {
  const declared = parseDeclaredCatalog(workspaceYaml)
  const locked = parseLockedCatalog(lockfile)

  // 前置条件：解析不出来说明格式变了，**不能当成「都对」**（那正是假绿的形态）
  if (declared.size === 0)
    return [{ rule: 'precondition', detail: 'pnpm-workspace.yaml 里解析不出任何 catalog 条目（格式变了？）' }]
  if (locked.size === 0)
    return [{ rule: 'precondition', detail: 'pnpm-lock.yaml 的第二段里解析不出 catalogs 条目（锁文件格式变了？）' }]

  const findings: Finding[] = []
  for (const [name, v] of declared) {
    const lk = locked.get(name)
    if (!lk) {
      findings.push({ rule: 'catalog-lockstep', detail: `catalog 声明了 \`${name}\`（${v}）但锁文件里没有` })
      continue
    }
    if (lk.specifier !== v)
      findings.push({ rule: 'catalog-lockstep', detail: `\`${name}\`：catalog 声明 ${v}，锁文件记的 specifier 是 ${lk.specifier}` })
    if (isExactVersion(v) && lk.version !== v)
      findings.push({ rule: 'catalog-lockstep', detail: `\`${name}\`：catalog 声明 ${v}，锁文件解析出 ${lk.version}` })
  }
  for (const name of locked.keys()) {
    if (!declared.has(name))
      findings.push({ rule: 'catalog-lockstep', detail: `锁文件里有 \`${name}\` 但 catalog 已删` })
  }
  return findings
}

/** 读 `HEAD` 里的一个文件（即将被 CI 检出的那一份） */
export function readHeadBlob(relPath: string, cwd = REPO_ROOT): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${relPath}`], { cwd, maxBuffer: 1 << 28, encoding: 'utf8' })
  }
  catch {
    return null
  }
}

/**
 * 比对的是 **HEAD 里那一对**（见文件头「为什么必须比 HEAD」）。
 * 工作区那份只用于「HEAD 读不到」时的兜底诊断，**不作为判据**。
 */
export function collectFindings(cwd = REPO_ROOT): Finding[] {
  const ws = readHeadBlob('pnpm-workspace.yaml', cwd)
  const lock = readHeadBlob('pnpm-lock.yaml', cwd)

  if (ws === null || lock === null) {
    return [{
      rule: 'precondition',
      detail: `读不到 HEAD 里的 ${ws === null ? 'pnpm-workspace.yaml' : 'pnpm-lock.yaml'} —— 需要一个至少有一次提交的 git 仓库（这是「检出即 CI 会炸」的判据来源）`,
    }]
  }
  return compareCatalogs(ws, lock)
}

export function main(): number {
  const findings = collectFindings()
  const precondition = findings.filter(f => f.rule === 'precondition')

  if (precondition.length > 0) {
    console.error(`✖ 前置条件未满足：\n${precondition.map(f => `  ${f.detail}`).join('\n')}`)
    return 2
  }
  if (findings.length === 0) {
    console.log('catalog ↔ 锁文件（HEAD 里那一对）：全部锁步 ✅')
    return 0
  }
  console.error(`✖ HEAD 里的 catalog 与锁文件有 ${findings.length} 处不一致 —— CI 会在 \`pnpm install --frozen-lockfile\` 阶段失败（它的报错不会说清是哪一条）：\n`)
  for (const f of findings)
    console.error(`  [${f.rule}] ${f.detail}`)
  console.error('\n修法：在工作区跑一次 `pnpm install`，把 `pnpm-lock.yaml` 一起提交。')
  return 1
}
