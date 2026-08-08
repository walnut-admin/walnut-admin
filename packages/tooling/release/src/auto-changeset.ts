import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function run(cmd: string): string {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim()
}

function log(msg: string) {
  console.log(`\x1B[36m[auto-changeset]\x1B[0m ${msg}`)
}

const CHANGESET_DIR = path.resolve('.changeset')
// Primary package for changesets; all others kept in sync via `fixed` group in .changeset/config.json
const PACKAGE_NAME = '@walnut/admin'

/** bump 类型映射：约定式提交前缀 → changeset 类型 | "skip" */
const BUMP_MAP: Record<string, string> = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  refactor: 'patch',
  revert: 'patch',
  docs: 'skip',
  chore: 'skip',
  style: 'skip',
  test: 'skip',
  build: 'skip',
  ci: 'skip',
}

/** 噪声关键词（忽略匹配的 commit） */
const NOISE_PATTERNS = [
  /^(wip|WIP):/,
  /^(fixup!|squash!)/,
  /^tmp\b/i,
  /^draft\b/i,
]

function isNoise(message: string): boolean {
  if (message.length < 4)
    return true
  // 纯数字/日期 如 "1", "6.4", "0527"
  if (/^\d+(?:\.\d+)*$/.test(message))
    return true
  return NOISE_PATTERNS.some(r => r.test(message))
}

interface ParsedCommit {
  hash: string
  type: string | null
  scope: string | null
  breaking: boolean
  summary: string
}

function parseCommit(line: string): ParsedCommit | null {
  const [hash, ...rest] = line.split('||')
  const message = rest.join('||') // 摘要可能含 ||

  if (!hash || !message)
    return null
  if (isNoise(message))
    return null

  // 匹配约定式提交: type(scope)!: summary 或 type: summary
  const cc = /^(\w+)(?:\(([^)]*)\))?(!)?:([\s\S]*)$/.exec(message)
  if (cc) {
    return {
      hash,
      type: cc[1].toLowerCase(),
      scope: cc[2] || null,
      breaking: cc[3] === '!',
      summary: cc[4].trimStart(),
    }
  }

  // 无前缀但有意义的摘要
  return { hash, type: null, scope: null, breaking: false, summary: message }
}

function getBump(parsed: ParsedCommit): string {
  if (parsed.breaking)
    return 'major'
  if (parsed.type && BUMP_MAP[parsed.type]) {
    return BUMP_MAP[parsed.type]
  }
  // 无前缀 → 默认 patch
  return 'patch'
}

function formatSummary(parsed: ParsedCommit): string {
  if (parsed.scope) {
    return `${parsed.scope}: ${parsed.summary}`
  }
  return parsed.summary
}

/** 获取 commit 变更的文件列表 */
function getCommitFiles(hash: string): string[] {
  try {
    const output = run(`git diff-tree --no-commit-id --name-only -r ${hash}`)
    if (!output)
      return []
    return output.split('\n').filter(Boolean)
  }
  catch {
    return []
  }
}

/** 只涉及非代码目录的 commit 无需触发发版 */
const NON_CODE_DIRS = ['docs/', '.github/', '.vscode/', '.changeset/']

function isWorkspaceCommit(files: string[]): boolean {
  if (files.length === 0)
    return false
  return !files.every(f => NON_CODE_DIRS.some(dir => f.startsWith(dir)))
}

function getLastTag(): string | null {
  try {
    return run('git describe --tags --abbrev=0')
  }
  catch {
    log('未找到 git tag，将使用首个 commit 作为起点')
    return null
  }
}

function getCommitsSince(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  try {
    const output = run(
      `git log --no-merges --format="%h||%s" ${range}`,
    )
    if (!output)
      return []
    return output.split('\n').filter(Boolean)
  }
  catch {
    return []
  }
}

function ensureMainBranch() {
  const branch = run('git rev-parse --abbrev-ref HEAD')
  if (branch !== 'main') {
    log(`❌ 只能在 main 分支执行发版，当前分支: ${branch}`)
    process.exit(1)
  }
}

function main() {
  ensureMainBranch()
  log('从 git commit 自动生成 changeset...')

  const lastTag = getLastTag()
  log(lastTag ? `上次 release: ${lastTag}` : '无历史 tag，扫描全部 commit')

  const commits = getCommitsSince(lastTag)
  if (commits.length === 0) {
    log('没有新 commit，跳过')
    return
  }

  let generated = 0
  let skipped = 0
  let filtered = 0

  for (const line of commits) {
    const parsed = parseCommit(line)
    if (!parsed) {
      filtered++
      continue
    }

    // 过滤只改了 docs/.github 等非代码文件的 commit
    const files = getCommitFiles(parsed.hash)
    if (!isWorkspaceCommit(files)) {
      filtered++
      continue
    }

    const bump = getBump(parsed)
    if (bump === 'skip') {
      filtered++
      continue
    }

    const filename = `auto-${parsed.hash}.md`
    const filepath = path.join(CHANGESET_DIR, filename)

    // 幂等：已存在则跳过
    if (fs.existsSync(filepath)) {
      skipped++
      continue
    }

    const summary = formatSummary(parsed)
    const commitType = parsed.type || 'other'
    const content = `---\n"${PACKAGE_NAME}": ${bump}\n---\n\n${parsed.hash} ::: ${commitType} ::: ${summary}\n`

    fs.writeFileSync(filepath, content, 'utf-8')
    generated++
  }

  log(`生成 ${generated} 个 changeset，跳过 ${skipped} 个（已存在），过滤 ${filtered} 个（噪声/无意义/内部改动）`)
}

main()
