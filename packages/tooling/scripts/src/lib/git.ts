/**
 * **通用** git 只读访问面：一条命令行一个具名函数，argv 直传，cwd 固定仓库根，读不到返回 null / 空集。
 *
 * 为什么需要：脚本里到处是 `execSync('git …')` 这种**整条命令行**，调用点把 ref / 分支名拼进去 ——
 * 而 git 允许 ref 名含 `$ ( ) { } > "`，一个被污染的值就能执行命令替换（实测
 * `git show v9.9.9$(touch PWNED):…` 真会建出文件）；cwd 也随运行目录漂移（从子目录跑会读错位置）。
 * 这里统一成 argv + `cwd: REPO_ROOT`，两类问题一起消失。
 * 失败口径：读不到就返回 null / 空数组（由调用方决定怎么办）；**值不合法抛** `PreconditionError`
 * （→ 退出码 2）；`lsFilesStrict` 连「git 跑不动」也抛 —— 「扫描面未知」绝不能静默变成「空集」。
 * 不做什么：**零业务语义**（不认识「发版」「包」「意图」），不打印、不决定退出码、不写盘。
 *
 * 环境：这里的子进程用 `process.env`（**不做凭据剥离**）。理由是本模块只跑只读查询
 * （rev-parse / describe / log / show / ls-files / status / ls-remote / rev-list / diff-tree），
 * 它们不触发任何仓库钩子、也不执行仓库里的代码；`GIT_TERMINAL_PROMPT=0` 仍然强制 ——
 * 否则凭据缺失时 git 会**挂在交互提示上**，在 CI 里表现为「卡死」而不是「失败」。
 * 会触发钩子的动作（commit / tag / push / pnpm）一律走 lib/child-run.ts。
 */

import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { PreconditionError } from './errors.ts'
import { assertSafeRef } from './ref-guard.ts'
import { REPO_ROOT } from './repo-root.ts'

/** 短命令的兜底预算（git 查询不该挂死；真正的长命令走 lib/child-run.ts 的预算体系） */
const GIT_TIMEOUT_MS = 5 * 60_000

/**
 * 跑 git：argv 直传、不经 shell、cwd 固定仓库根、时间有界。**读不到把 stderr 正文带回来**（不抛）。
 *
 * 刻意不导出：对外只有下面那些具名只读查询 —— 这样「只读」不是一句承诺，而是没有别的写法。
 */
function runGit(args: string[]): { ok: true, out: string } | { ok: false, detail: string } {
  return runGitInternal(args, true)
}

/**
 * 与 `runGit` 同形，但**不 trim 聚合输出**。
 *
 * 为什么必须单独有一条：`git status --porcelain` 是**定宽**格式 —— 每行前两列是状态位、第三列是空格
 * （` M path` / `?? path` / `D  path`）。对整段输出 `.trim()` 会吃掉**第一行**的前导空格，于是
 * 「状态位 + 空格」的固定切片在首行错位一位，路径就少掉一个字符
 * （实测：`.changeset/README.md` 被读成 `changeset/README.md` ⇒ 「发版自己会改的文件」判据失效，
 * 本来不该进提交的 ledger/意图文件会被当成「无关改动」）。
 */
function runGitRaw(args: string[]): { ok: true, out: string } | { ok: false, detail: string } {
  return runGitInternal(args, false)
}

function runGitInternal(args: string[], trim: boolean): { ok: true, out: string } | { ok: false, detail: string } {
  try {
    const raw = execFileSync('git', args, {
      stdio: 'pipe',
      cwd: REPO_ROOT,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).toString()
    return { ok: true, out: trim ? raw.trim() : raw }
  }
  catch (error) {
    const e = error as { stderr?: unknown, stdout?: unknown, message?: unknown }
    const detail = [e.stderr?.toString().trim(), e.stdout?.toString().trim()].filter(Boolean).join('\n')
    return { ok: false, detail: detail || String(e.message ?? 'git 失败') }
  }
}

/** 读不到返回 null（调用方决定怎么办） */
function tryGit(args: string[]): string | null {
  const result = runGit(args)
  return result.ok ? result.out : null
}

/** 断言版：失败时抛 `PreconditionError` 并带上 stderr 正文（读不到的原因才是排查需要的） */
function git(args: string[]): string {
  const result = runGit(args)
  if (!result.ok)
    throw new PreconditionError(result.detail)
  return result.out
}

// ── 仓库与分支 ────────────────────────────────────────────────────────────
export function currentBranch(): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'])
}

/** HEAD 的完整 sha（与已有 tag 比对时要用完整值：tag 必须指向 HEAD） */
export function headCommit(): string | null {
  return tryGit(['rev-parse', 'HEAD'])
}

export function headSubject(): string | null {
  return tryGit(['log', '-1', '--format=%s'])
}

export function gitRemoteUrl(): string | null {
  return tryGit(['remote', 'get-url', 'origin'])
}

/** 某个 ref 指向的 commit 的短 sha（先把 `^` 与 `..` 挡在 argv 之外，见 lib/ref-guard.ts） */
export function shortCommit(ref: string): string | null {
  return tryGit(['rev-parse', '--short', `${assertSafeRef(ref, 'ref')}^{commit}`])
}

// ── tag ───────────────────────────────────────────────────────────────────
/** 最近的 tag（`git describe --tags --abbrev=0`）；仓库里一个 tag 都没有时返回 null */
export function lastTag(): string | null {
  return tryGit(['describe', '--tags', '--abbrev=0'])
}

export function tagExistsLocally(tag: string): boolean {
  return tryGit(['rev-parse', '-q', '--verify', `refs/tags/${assertSafeRef(tag, 'tag 名')}`]) !== null
}

export function tagExistsRemotely(tag: string): boolean {
  return (tryGit(['ls-remote', '--tags', 'origin', assertSafeRef(tag, 'tag 名')]) ?? '') !== ''
}

/** tag 指向的 commit（打标前与 HEAD 一致性复核、Release 的 target） */
export function tagCommit(tag: string): string | null {
  return tryGit(['rev-parse', `${assertSafeRef(tag, 'tag 名')}^{commit}`])
}

// ── 提交 ──────────────────────────────────────────────────────────────────
/**
 * 自某个基线以来的提交（`{ hash, subject }`）—— 区间是 `<tag>..HEAD`，没有基线就是整个 `HEAD`。
 *
 * 用 `%x1f`（单元分隔符）而不是 `||` / 空格：commit 摘要里这两种字符都常出现，用它们做分隔会被
 * 摘要内容误伤（切成两半或错位）；US 是 ASCII 控制字符，人不会打进提交信息里。
 */
export function commitsSince(tag: string | null): { hash: string, subject: string }[] {
  const out = tryGit(['log', '--no-merges', '--format=%h%x1f%s', rangeSince(tag)]) ?? ''
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', subject = ''] = line.split('\u001F')
      return { hash, subject }
    })
}

/**
 * 自某个基线以来的提交**条数**。
 *
 * 与 `commitsSince` 共用同一个区间与 `--no-merges` 口径 —— 两条查询必须能对上账
 * （`commitCount(t) === commitsSince(t).length`），否则「还剩几条没发」会与列表长度不一致。
 */
export function commitCount(tag: string | null): number {
  const count = tryGit(['rev-list', '--no-merges', '--count', rangeSince(tag)])
  return count === null ? 0 : Number(count)
}

/** 区间口径的唯一来源：有基线是 `<tag>..HEAD`，没有就是整个 `HEAD` */
function rangeSince(tag: string | null): string {
  return tag === null || tag === '' ? 'HEAD' : `${assertSafeRef(tag, '基线 tag')}..HEAD`
}

/**
 * 某个提交改动的文件（`--root`：首个提交也要能列出，否则「第一版」的改动永远是空集）。
 *
 * hash 走 `assertSafeRef` 而不是「十六进制白名单」：既能挡 `--output=<文件>` 这类**选项形态**的
 * 注入（以 `-` 开头即拒），又允许调用方传 `HEAD` 这种正常 ref。
 */
export function commitFiles(hash: string): string[] {
  return (tryGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', assertSafeRef(hash, '提交 hash')]) ?? '')
    .split('\n')
    .filter(Boolean)
}

// ── 分支与上游 ────────────────────────────────────────────────────────────
/** 分支是否已与上游同步（无未推送提交）；没有上游时退化成与 `origin/<分支>` 比 */
export function branchIsPushed(branch: string): boolean {
  const safe = assertSafeRef(branch, '分支名')
  const upstream = tryGit(['rev-parse', '--abbrev-ref', `${safe}@{upstream}`]) ?? `origin/${safe}`
  const ahead = tryGit(['rev-list', '--count', `${assertSafeRef(upstream, '上游分支名')}..${safe}`])
  return ahead !== null && Number(ahead) === 0
}

/**
 * 本地分支**落后上游**多少提交（0 = 不落后）；没有上游时按 `origin/<分支>` 比，比不出来算 0。
 *
 * 为什么需要它：`git push origin <分支> <tag>` 里两条 ref 是**独立**处理的 —— 分支因
 * non-fast-forward 被拒时，tag 照样会推上去。于是「发版期间远端前进」会留下一个棘手的中间态：
 * 远端多了一个指向**未推送提交**的 tag，而分支还在旧位置。所以这条判据必须前置到动仓库之前。
 */
export function branchBehind(branch: string): number {
  const safe = assertSafeRef(branch, '分支名')
  const upstream = tryGit(['rev-parse', '--abbrev-ref', `${safe}@{upstream}`]) ?? `origin/${safe}`
  const behind = tryGit(['rev-list', '--count', `${safe}..${assertSafeRef(upstream, '上游分支名')}`])
  return behind === null ? 0 : Number(behind)
}

// ── 文件与工作区 ──────────────────────────────────────────────────────────
/**
 * `git ls-files` 的**安静**版：git 跑不动时与「一个文件都没有」同形（返回 `[]`）。
 *
 * `-c core.quotePath=false` 不能省：默认值把非 ASCII 路径按 C 风格转义并**加引号**
 * （`"apps/admin/src/\344\270\200.md"`），于是路径前缀判断全部失效。
 */
export function lsFiles(pattern: string): string[] {
  return (tryGit(['-c', 'core.quotePath=false', 'ls-files', '--full-name', pattern]) ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * `git ls-files` 的**响亮**版：git 跑不动（不在检出内 / 不在 PATH / 权限）就抛 `PreconditionError`，
 * 绝不返回 `[]`。
 *
 * 为什么必须有它：`lsFiles()` 把「git 失败」与「一个文件都没有」都收敛成 `[]`，而 `[]` **正是**
 * 各门禁都在挡的「空扫描面渲染成绿灯」⇒ 抽象恰好在最需要复用的地方漏了。
 * 空集护栏仍留在调用方（**什么算扫描面**各自定，措辞也各不相同）。
 */
export function lsFilesStrict(pattern: string): string[] {
  return git(['-c', 'core.quotePath=false', 'ls-files', '--full-name', pattern])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * 一次问 git：这批路径里哪些**被 gitignore**。
 *
 * 为什么是「一次问一批」而不是逐条：`check-ignore` 是个进程 —— 逐条 spawn 会让一次全仓扫描
 * 从 1 秒变成 15 秒（实测：`check-doc-refs` 因为每条引用要探三种形态，vitest 的 5s 超时当场红）。
 *
 * 为什么调用方要把**两种形态**都喂进来：`.gitignore` 里的 `dist/` 是**目录**模式，而 git 对一个
 * **不在盘上**的路径判断不出它是不是目录 ⇒ 不带尾斜杠时问不出结果（实测：目录在盘上时报 ignored，
 * 把目录挪走后同一问法变成 not-ignored）。这里替调用方补上带尾斜杠的那一份，返回集合里统一去掉它。
 *
 * 读不到（git 失败 / 不在检出内）返回**空集** —— 调用方按"没被忽略"处理，宁可报出来也不静默放过。
 */
export function ignoredPaths(paths: Iterable<string>): Set<string> {
  const list = [...paths]
  if (list.length === 0)
    return new Set()
  const input = `${[...list, ...list.map(p => `${p}/`)].join('\0')}\0`
  try {
    const out = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: REPO_ROOT,
      input,
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    }).toString()
    return new Set(out.split('\0').filter(Boolean).map(p => p.replace(/\/$/, '')))
  }
  catch {
    // 「一个都没被忽略」时 git 的退出码是 1 —— 对我们要的语义来说就是空集
    return new Set()
  }
}

/**
 * 跟踪面 **∪ 未跟踪但未被忽略** 的文件。
 *
 * 为什么需要第三档（前两档是 lsFiles / lsFilesStrict）：**工作区包清单要按盘上实际有什么来算**，
 * 而不是按「已经提交了什么」。pnpm 自己解析 workspace 时读的是盘上的 `package.json`；
 * 新增一个包、还没提交就发版时，只看跟踪面会把那个包判成「不存在」，
 * 于是 `versioning.fixed` 的审计会报出「组里有、工作区没有」的假警（实测踩到）。
 *
 * `--exclude-standard` 仍然生效 ⇒ `node_modules` 等被忽略的目录不会被卷进来。
 */
export function lsFilesWithUntracked(pattern: string): string[] {
  return git(['-c', 'core.quotePath=false', 'ls-files', '--full-name', '--cached', '--others', '--exclude-standard', pattern])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * `git status --porcelain` 的原始行（未跟踪文件可选；缺省包含）。
 *
 * 走 `runGitRaw`（不 trim）：本格式是**定宽**的，整段 trim 会吃掉第一行的前导空格，
 * 于是下面按「状态位 + 空格」切路径的写法在首行错位一位（详见 `runGitRaw` 的注释）。
 */
export function porcelain(includeUntracked = true): string[] {
  // `-c core.quotePath=false` 与 ls-files 同口径：默认值把非 ASCII 路径按 C 风格转义并加引号，
  // 于是路径前缀判断（`.changeset/`、`apps/admin/`）全部失效。
  const args = ['-c', 'core.quotePath=false', 'status', '--porcelain']
  if (!includeUntracked)
    args.push('--untracked-files=no')
  const result = runGitRaw(args)
  if (!result.ok)
    return []
  return result.out.split('\n').filter(line => line.length > 0)
}

/**
 * 已跟踪且被改动的文件（未跟踪文件不算：调用方通常要判断「谁改了我认识的东西」）。
 *
 * 解析用「两列状态位 + 一个空格」（porcelain v1 的定宽前缀），而不是 `slice(3)`：
 * 后者依赖调用方没对输出做过 trim —— 那是个只在**首行**成立的隐形前提。
 */
export function trackedDirtyFiles(): string[] {
  return porcelain(false)
    .map((line) => {
      const matched = /^.{2}\s(.*)$/.exec(line)
      const path = (matched ? matched[1] : line).trim()
      // 仍然可能被 git 加引号（路径含 `"` 或 `\`）—— 剥掉外层成对引号
      return path.length > 1 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
    })
    .filter(Boolean)
}

/** 工作区改动条数（`git status --porcelain` 的行数，含未跟踪） */
export function changedFileCount(): number {
  return porcelain().length
}

/**
 * 某个 ref 处某文件的内容（读历史版本的文件）。
 *
 * 结果是**已 trim** 的（共用执行器统一 trim）：用来做文本对账足够，需要逐字节还原时不要用它。
 */
export function fileAtRef(ref: string, path: string): string | null {
  return tryGit(['show', `${assertSafeRef(ref, 'ref')}:${path}`])
}
