/**
 * 文档引用校验：**活文档**里提到的 workspace 包名与仓库路径必须真实存在。
 *
 * 为什么要有它（两次实测的战果，不是假想需求）：
 * - 2026-09-23 第一轮按「不存在的包名」扫，查出 `attribution.ts` 里 `'tooling': '@walnut/tooling'`
 *   这条**陈尸** —— 那个包早已拆成 5 个，而它会让一条提交为幽灵包写出版本意图；同轮还查出
 *   `README.md` 的结构块整块虚构（`packages/{shared,axios,core}` 三个包一个都不存在）。
 * - 第二轮按「不存在的路径」扫，查出 9 类失效引用：ADR 里全是迁移前的 `docs/reference/*`、
 *   `.claude/skills/**` 把 DB Model 常量指到错误目录、以及**引用了一个根本不存在**的
 *   `migration-guide/` 目录。
 *
 * 判据（**宁可漏报，不可误报**）：一个门禁一旦有噪声，人就会开始无视它，等于没做。
 * 因此本模块刻意收窄：
 *   ① 包名只认 `@walnut/<段>` 形态；`@walnut-server/*` 是后端内部 lib 命名空间（不是包），不查。
 *   ② 路径只在 **markdown** 里查（代码里的 import 由 tsc / boundaries 管），且必须**以顶层目录开头**
 *      （`apps/` `packages/` `deploy/` `.github/` …），否则不认 —— 半截相对片段太容易误判。
 *   ③ 路径允许**语境解析**：先按仓库根解析，再按文档自身所在目录、以及 `apps/server/` 解析
 *      （`env-encrypted/` 这类写法就是相对 server 的）。任一命中即算存在。
 *   ④ 冻结语料（`content/archive/`、`content/industry-research/`）**不扫** —— 它们有意保留当时的路径。
 *   ⑤ 明确「尚未存在 / 有意删除」的少数引用走 `ALLOWED_*` 清单，**每一条都写了理由**；清单变长
 *      本身就是信号（说明有人开始往门禁里塞豁免而不是修引用）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { ignoredPaths, lsFilesWithUntracked } from '../lib/git.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { workspacePackageNames } from '../lib/workspace.ts'

/**
 * 冻结语料：有意保留当时路径的历史文档，不参与校验。
 * ⚠️ 与 VitePress 的 `ignoreDeadLinks` 白名单是**同一条口径**（见 apps/docs/.vitepress/config/index.ts）。
 */
const FROZEN = /(?:^|\/)content\/(?:archive|industry-research)\//

/**
 * **只对路径引用**生效的排除面。
 *
 * 为什么要把 ADR 排掉：ADR 是「某时刻的决策记录」，它**合法地**引用当时存在、现在已经没有的路径
 * —— 例如 ADR 0017 讲的就是包重组本身，正文里那张"重组前"表列的全是旧路径。把它们算失效，
 * 门禁就会长出一串永远不修、只能豁免的条目。
 * 代价很小：ADR 里的**markdown 链接**仍被 VitePress 内置死链校验覆盖（那是另一条闸）。
 *
 * 为什么把待办文档排掉：`architecture-todo.md` 的职责恰恰是**记录失效的引用本身**
 * （「裸 `scripts/…` → 补全为 …」「`migration-guide/` 目录根本不存在」），它必然包含死路径。
 */
const PATH_CHECK_EXCLUDED = /(?:^|\/)content\/adr\/|architecture-todo\.md$/

/** 后端内部 lib 的命名空间：不是 workspace 包，没有 package.json */
const SERVER_LIB_NAMESPACE = '@walnut-server/'

/** 路径引用只认这些顶层目录开头的（收窄判据 ②） */
const TOP_LEVEL_DIRS = [
  'apps',
  'packages',
  'deploy',
  'scripts',
  'docs',
  '.github',
  '.changeset',
  '.vscode',
  '.claude',
  'env-encrypted',
  'env-local',
  'migration-guide',
]

const PATH_EXT = /\.(?:ts|tsx|vue|js|mjs|cjs|json|jsonc|yaml|yml|toml|sh|hcl|css|md|env|d\.ts)$/

/**
 * 允许「不存在」的**路径**引用。每条都要写清理由 —— 没理由的豁免等于把门禁关掉。
 *
 * 只有 3 条：**路径**那一半刻意收得很紧（`PATH_CHECK_EXCLUDED` 已经把 ADR 与待办文档排掉），
 * 所以这里的长度本身就是「扫描面有没有失控」的体温计。
 */
export const ALLOWED_MISSING_PATHS: Record<string, string> = {
  '.changeset/ledger.yaml': '首次发版时才生成（pnpm 的消费台账）',
  '.changeset/.release-state.json': '发版中间状态，gitignored，只在跑发版时短暂存在',
  '.changeset/config.json': '有意删除（迁到 pnpm-workspace.yaml 的 versioning 段），引用处都在说「已删除」',
  'apps/server/changelog-latest.md': '已删除的历史产物；引用处的原话就是「已删除两个陈旧 changelog」',
  'deploy/env/.env.production': '部署机上的运行时文件（gitignored）',
  'deploy/nginx/certs/': '证书目录，只在服务器上存在（gitignored）',
  // 「提及某路径**正是因为**它不存在」是合法写法，机械检查分辨不了，只能豁免：
  // 两处原文分别是「根 `scripts/` 目录已不存在」与「根 `scripts/` 目录不存在，根 scripts 只经 bin 调用」。
  'scripts/': '根 scripts/ 目录已取消（拆进 packages/tooling/）；引用处在说它不存在',
}

/**
 * 允许「不存在」的**包名**引用。分三类，都写理由。
 */
export const ALLOWED_MISSING_PACKAGES: Record<string, string> = {
  // 规划中（架构待办有对应条目，建出来之后应从本清单删掉）
  '@walnut/i18n': '规划中（待办 A8）',
  '@walnut/security': '规划中（待办 A9）',
  // 已更名 / 已删除：引用处都是历史叙述
  '@walnut/axios': '已更名 @walnut/http（2026-07）。现在只剩 ADR（改名决策的历史记录）与冻结语料里还提它 —— 2026-09-23 把最后一处活文档（`content/introduction.md` 的包清单）改正后，活文档已零引用',
  '@walnut/tooling': '已拆成 6 个包（2026-09）',
  '@walnut/shared': '从未存在（ADR 0001 讨论过的候选名）',
  '@walnut/core': '从未存在（ADR 0001 讨论过的候选名）',
  '@walnut/ai': '已删除的空壳包',
  // 名称 ≠ 目录名，容易被写错；正名是 @walnut/utils
  '@walnut/utils-core': '包名是 @walnut/utils，`utils-core` 只是目录名',
  // 归档的抽取提案 / 行业调研里的示例名
  '@walnut/als': '归档提案里的候选名',
  '@walnut/mask': '归档提案里的候选名',
  '@walnut/mailer': '归档提案里的候选名',
  '@walnut/cache': '归档提案里的候选名',
  '@walnut/crud': '归档提案里的候选名',
  '@walnut/admin-dist': '行业调研里的示例镜像名',
  '@walnut/server-dist': '行业调研里的示例镜像名',
}

export interface DocRefs {
  packages: Map<string, string[]>
  paths: Map<string, string[]>
}

/** 扫描面：全部跟踪（∪ 未跟踪）的 .md，排除冻结语料 */
export function liveDocs(): string[] {
  return lsFilesWithUntracked('*.md').filter(f => !FROZEN.test(f))
}

/** 包名引用：`@walnut/<段>`（`@walnut-server/` 不查，见模块头注释 ①） */
export function extractPackageRefs(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/@walnut\/([a-z0-9][a-z0-9-]*)/g))
    found.add(`@walnut/${m[1]}`)
  return [...found]
}

/** 路径引用：markdown 反引号里、以顶层目录开头、带扩展名或以 `/` 结尾的 token（判据 ②） */
export function extractPathRefs(text: string): string[] {
  const found = new Set<string>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim()
      // 去掉行内注释尾巴与锚点
      const token = raw.split(/\s+#/)[0].split('#')[0].trim()
      // `*` 通配、`<包>` 占位、`...` 省略、`$VAR`、含空格的句子 —— 都不是可解析的路径
      if (!token || /[*<>{}|$\s]/.test(token) || token.includes('...'))
        continue
      if (token.startsWith('~/') || token.startsWith('http'))
        continue
      if (!TOP_LEVEL_DIRS.some(dir => token === `${dir}/` || token.startsWith(`${dir}/`)))
        continue
      const looksLikePath = PATH_EXT.test(token) || token.endsWith('/') || !token.includes('.')
      if (!looksLikePath)
        continue
      found.add(token)
    }
  }
  return [...found]
}

export interface Finding {
  kind: 'package' | 'path' | 'link' | 'alias'
  ref: string
  files: string[]
}

/**
 * **别名基址唯一可判**的文件 → 该按哪个基址解析。返回 `null` = 这类文件不查别名。
 *
 * 为什么只查这几类：`@/` 的基址随 app 而变（后端 `apps/api/src`、前端 `apps/admin/src`），
 * 普通文档里**无从判断**该按哪个解析 ⇒ 一律不管（宁可漏报不可误报）。下面这些地方的基址是唯一的：
 *
 * | 文件 | 基址 | 判据 |
 * |------|------|------|
 * | `.claude/skills/` 下 `be-` 前缀的目录 | 后端 | 目录名前缀就是约定（`be-` = backend） |
 * | `.claude/skills/` 下 `fe-` 前缀的目录 | 前端 | 同上（`fe-` = frontend） |
 * | `apps/server/libs/` 下的 markdown | 后端 | 后端内部 lib 的文档只服务后端 |
 *
 * 为什么值得为它们破例：**这批文件是 agent 照着做的东西**。2026-09-23 实测 —— 13 个 skill 文件里
 * **12 处**别名指向不存在的路径（`@/decorators/field`、`@/const/permissions`、
 * `@/hooks/core/useProps`、`@walnut/utils/dto`），而 `libs/db/README.md` 里还写着
 * 一个全仓 0 命中的 `WalnutAdminConstDBModelName`。**两条门禁都看不见它们**：
 * 别名不以顶层目录开头（判据 ② 跳过），也不是 `@walnut/*` 包名。
 */
function aliasBaseOf(file: string): 'server' | 'admin' | null {
  if (/^\.claude\/skills\//.test(file)) {
    const skill = file.split('/')[2] ?? ''
    if (skill.startsWith('be-'))
      return 'server'
    if (skill.startsWith('fe-'))
      return 'admin'
    return null
  }
  if (/^apps\/server\/libs\//.test(file))
    return 'server'
  return null
}

/** 反引号里的 TS 别名引用：`@/…` 或 `@walnut-server/…` */
export function extractAliasRefs(text: string): string[] {
  const found = new Set<string>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence)
      continue
    for (const m of line.matchAll(/`(@\/[\w./-]+|@walnut-server\/[\w./-]+)`/g)) {
      const ref = m[1] ?? ''
      if (!ref.includes('*'))
        found.add(ref)
    }
  }
  return [...found]
}

/** 别名 → 可能的真实文件（按 `.ts` / `.tsx` / `.vue` / `index.*` 展开） */
function aliasCandidates(ref: string, base: 'server' | 'admin'): string[] {
  let dir: string
  if (ref.startsWith('@walnut-server/')) {
    const [lib, ...rest] = ref.slice('@walnut-server/'.length).split('/')
    dir = path.posix.join('apps/server/libs', lib ?? '', 'src', ...rest)
  }
  else {
    dir = path.posix.join(base === 'server' ? 'apps/server/apps/api/src' : 'apps/admin/src', ref.slice(2))
  }
  return [dir, `${dir}.ts`, `${dir}.tsx`, `${dir}.vue`, `${dir}/index.ts`, `${dir}/index.tsx`, `${dir}/index.vue`]
}

/** 这个别名引用能不能落到真实文件上（基址不唯一可判的文件一律返回 true —— 见 `aliasBaseOf`） */
export function aliasResolves(ref: string, file: string, fsExists: (repoRelative: string) => boolean): boolean {
  const base = aliasBaseOf(file)
  if (base === null)
    return true
  return aliasCandidates(ref, base).some(fsExists)
}

/**
 * markdown 链接目标里**显式相对**（`./` / `../` 开头）的那些。
 *
 * 为什么单独要看链接：反引号里的路径只是「提及」，而链接是**承诺能点开**。两者的失效形态不同，
 * 覆盖也不同 —— 文档站的链接由 VitePress 内置死链校验管，但**仓库里其它 markdown**
 * （各 app 的 `README.md`、`apps/server/AGENTS.md`、`.claude/` 下的技能文件）没人管。
 * 2026-09-23 实测：`apps/server/AGENTS.md` 那份 14 行索引**每一条都指向不存在的文件**
 * （`.agents/docs/` 目录从未进仓库），而当时的门禁只看反引号，完全没看见。
 *
 * 只认 `./` `../` 开头：站点绝对路径（`/content/...`）是 VitePress 的语义，由它自己校验。
 */
export function extractLinkTargets(text: string): string[] {
  const found = new Set<string>()
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence)
      continue
    // 行内链接 `](target)` 与引用式定义 `[id]: target`（去掉可选的 "title" 与 <...> 包裹）
    const raw = [
      ...[...line.matchAll(/\]\(([^)\n]+)\)/g)].map(m => m[1]),
      ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)].map(m => m[1]),
    ]
    for (const item of raw) {
      const target = item.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
      if (!target.startsWith('./') && !target.startsWith('../'))
        continue
      found.add(target.split('#')[0])
    }
  }
  return [...found].filter(Boolean)
}

/**
 * 链接目标能否解析：按文档所在目录解析，依次试**原样**、**补 `.md`**、**当目录找 index**。
 *
 * 三条都试是为了对齐 VitePress 的解析规则 —— 本仓文档里 174 条相对链接有 15 条不带 `.md`
 * （`./ci-cd`），只按原样判会把它们全报成死链。
 */
export function linkResolves(target: string, docFile: string, fsExists: (repoRelative: string) => boolean): boolean {
  const docDir = path.posix.dirname(docFile)
  const base = path.posix.normalize(path.posix.join(docDir, target))
  return fsExists(base)
    || fsExists(`${base}.md`)
    || fsExists(`${base}/index.md`)
}

/**
 * 路径能否解析：仓库根 → 文档所在目录 → `apps/server/`（判据 ③）。
 *
 * `fsExists` 收到的是**仓库相对、正斜杠**的路径 —— 三个探针都用 `path.posix` 拼，
 * 由调用方（默认实现）决定怎么落到真实文件系统。**不要把绝对路径透出去**：
 * 在 Windows 上 `path.join` 会给出反斜杠，调用方写 `endsWith('apps/server/x')` 这种断言就会假失败
 * （实测踩到），而 `fs.existsSync` 本来两种分隔符都认 —— 那就统一成正斜杠。
 */
/** 一条引用要探的三种基址（仓库根 → 文档所在目录 → `apps/server/`）—— `pathResolves` 与之同源 */
export function pathProbes(ref: string, docFile: string): string[] {
  const docDir = path.posix.dirname(docFile)
  return [
    ref,
    path.posix.normalize(path.posix.join(docDir, ref)),
    path.posix.join('apps/server', ref),
  ]
}

export function pathResolves(ref: string, docFile: string, fsExists: (repoRelative: string) => boolean): boolean {
  return pathProbes(ref, docFile).some(p => fsExists(p))
}

/**
 * 这个引用算不算「指向一个真实存在的仓库路径」。
 *
 * ⚠️ **「被 gitignore 的路径」也算** —— 这条是 2026-09-23 补的，起因是一次**本地全绿、CI 全红**：
 *
 * `env-local/`、`apps/admin/dist` 这类路径**只在有人的机器上存在**（一个要解密、一个是构建产物），
 * 干净检出里根本没有。于是同一份文档在本机通过、在 CI 上报「引用不存在的路径」——
 * 判据里混进了一个**与环境相关**的事实（"我这台机器上有没有那个目录"），
 * 而它想说的其实是"这个引用指不指向一个**仓库文件**"。
 *
 * 现在：路径不存在但被 gitignore ⇒ 它是**产物 / 运行时文件**，不当作死引用。
 * git 问不到（不在检出内 / 没装 git）时**按"没被忽略"处理**（宁可报出来，不静默放过）。
 *
 * ⚠️ **必须一次性批量问**（`git check-ignore --stdin`），不能每条路径起一个进程：
 * 第一版就是逐条 spawn，而 `pathResolves` 每条引用要探**三种**形态（原样 / 文档相对 / `apps/server/` 相对），
 * 后两种通常都不存在 ⇒ 一次全仓扫描变成几百次进程启动，实测 **15 秒**（vitest 默认 5s 超时当场红）。
 * 现在整轮只问一次 git。
 */
function ignoredProbes(probes: Iterable<string>): Set<string> {
  // 实现搬进 `lib/git.ts` 了（`exports` 门禁要用同一件事）—— 那里写着为什么必须「一次问一批」、
  // 以及为什么要把「带尾斜杠」的形态一起喂进去。
  return ignoredPaths(probes)
}

export interface CheckOptions {
  docs?: string[]
  realPackages?: Set<string>
  fsExists?: (repoRelative: string) => boolean
  /** 读文档正文；默认从盘上读。抽成参数是为了让单测能注入内容（不必在盘上造文件） */
  readText?: (file: string) => string
}

/**
 * 收集所有发现（纯函数，便于单测）。
 *
 * ⚠️ **两遍扫描，只为了一次 git 调用**（第一版逐条 spawn 让全仓扫描变成 15 秒）：
 *   1. 第一遍用**纯 `existsSync`** 跑，把「问过但不存在」的路径记进 `misses`；
 *   2. 拿 `misses` 一次性问 git（`check-ignore --stdin`），得到被 gitignore 的集合；
 *   3. 若有命中，用「存在 **或** 被 gitignore」再跑一遍。
 *
 * 这样做的额外好处：**路径引用、markdown 链接、`@/` 别名三种探针自动同权** ——
 * 不必为每种探针各写一套"要探哪些形态"的清单（那种清单一定会漏，而漏掉的那种就失去 gitignore 语义）。
 */
export function collectFindings(options: CheckOptions = {}): Finding[] {
  if (options.fsExists !== undefined)
    return runCollect(options, options.fsExists)

  const misses = new Set<string>()
  const first = runCollect(options, (p) => {
    const ok = fs.existsSync(path.join(REPO_ROOT, p))
    if (!ok)
      misses.add(p)
    return ok
  })
  if (misses.size === 0)
    return first

  const ignored = ignoredProbes(misses)
  if (ignored.size === 0)
    return first
  // 被 gitignore 的路径：`ignored` 里存的是**去掉尾斜杠**的形式，探针可能带尾斜杠
  return runCollect(options, p => fs.existsSync(path.join(REPO_ROOT, p)) || ignored.has(p.replace(/\/$/, '')))
}

function runCollect(options: CheckOptions, fsExists: (repoRelative: string) => boolean): Finding[] {
  const docs = options.docs ?? liveDocs()
  const realPackages = options.realPackages ?? workspacePackageNames()
  const readText = options.readText ?? ((file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))

  const pkgHits = new Map<string, string[]>()
  const pathHits = new Map<string, string[]>()
  const linkHits = new Map<string, string[]>()
  const aliasHits = new Map<string, string[]>()

  for (const file of docs) {
    const text = readText(file)
    for (const ref of extractPackageRefs(text)) {
      if (ref.startsWith(SERVER_LIB_NAMESPACE) || realPackages.has(ref) || ref in ALLOWED_MISSING_PACKAGES)
        continue
      pkgHits.set(ref, [...(pkgHits.get(ref) ?? []), file])
    }
    // 别名只管 `.claude/skills/**`（aliasResolves 内部按目录前缀决定要不要查，见它的注释）
    for (const ref of extractAliasRefs(text)) {
      if (aliasResolves(ref, file, fsExists))
        continue
      aliasHits.set(ref, [...(aliasHits.get(ref) ?? []), file])
    }
    for (const ref of extractPathRefs(text)) {
      if (PATH_CHECK_EXCLUDED.test(file))
        continue
      if (ref in ALLOWED_MISSING_PATHS || pathResolves(ref, file, fsExists))
        continue
      pathHits.set(ref, [...(pathHits.get(ref) ?? []), file])
    }
    for (const ref of extractLinkTargets(text)) {
      if (PATH_CHECK_EXCLUDED.test(file))
        continue
      // 分工（2026-09-23 实测后定的边界，**两边零重叠**）：
      //   · 文档站里的 `.md` 链接 → 交给 VitePress 内置死链校验（它有自己的白名单：冻结语料 +
      //     尚未编写的组件页）。实测它会在这个 case 上 exit 1。
      //   · 文档站里的**非 `.md`** 链接 → VitePress **不查**（实测：指向不存在的 `.yaml` 也照样 exit 0），
      //     所以留在这里查。`release.md` 那两条层级写错的 `../../../../../pnpm-workspace.yaml` 就是这么抓到的。
      //   · 文档站**之外**的 markdown 链接 → 没有任何工具管，全部在这里查。
      const isDocsTree = file.startsWith('apps/docs/src/')
      if (isDocsTree && ref.endsWith('.md'))
        continue
      if (linkResolves(ref, file, fsExists))
        continue
      linkHits.set(ref, [...(linkHits.get(ref) ?? []), file])
    }
  }

  const findings: Finding[] = [
    ...[...pkgHits].map(([ref, files]) => ({ kind: 'package' as const, ref, files })),
    ...[...pathHits].map(([ref, files]) => ({ kind: 'path' as const, ref, files })),
    ...[...linkHits].map(([ref, files]) => ({ kind: 'link' as const, ref, files })),
    ...[...aliasHits].map(([ref, files]) => ({ kind: 'alias' as const, ref, files })),
  ]
  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || b.files.length - a.files.length)
}

/** 真实 workspace 包名（读盘上的 package.json，不维护手写清单）—— 枚举逻辑在 `lib/workspace.ts` */
export { workspacePackageNames }

export function main(): void {
  const findings = collectFindings()
  const docs = liveDocs()
  if (docs.length === 0 || workspacePackageNames().size === 0) {
    throw new PreconditionError('扫描面为空（活文档 0 篇或 0 个包）—— 拒绝把「扫不到东西」当绿灯')
  }

  out(`文档引用校验：${docs.length} 篇活文档；包名豁免 ${Object.keys(ALLOWED_MISSING_PACKAGES).length} 条、路径豁免 ${Object.keys(ALLOWED_MISSING_PATHS).length} 条`)

  if (findings.length === 0) {
    line('ok', '没有引用不存在的包名或路径')
    return
  }

  for (const f of findings) {
    const label = f.kind === 'package' ? '包名' : f.kind === 'link' ? '链接' : f.kind === 'alias' ? '别名' : '路径'
    lineErr('violation', `${label} ${f.ref}  （${f.files.length} 处）`)
    for (const file of f.files.slice(0, 6)) err(`    ${file}`)
    if (f.files.length > 6)
      err(`    … 另外 ${f.files.length - 6} 处`)
  }
  err(`\n共 ${findings.length} 类失效引用。修掉它们，或在 check-doc-refs.ts 的 ALLOWED_* 清单里写明理由。`)
  throw new ViolationError(`文档引用有 ${findings.length} 类失效（明细见上）`)
}
