import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

function run(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim()
  }
  catch (err: any) {
    const stderr = err.stderr?.toString().trim() || ''
    const stdout = err.stdout?.toString().trim() || ''
    const detail = [stderr, stdout].filter(Boolean).join('\n')
    throw new Error(detail || err.message)
  }
}

function log(msg: string) {
  console.log(`\x1B[36m[release]\x1B[0m ${msg}`)
}

/** bump 优先级: major=3, minor=2, patch=1 */
function bumpPriority(bump: string): number {
  if (bump === 'major')
    return 3
  if (bump === 'minor')
    return 2
  return 1
}

/** 简单的 readline question 封装 */
function question(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve('')
      return
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(promptText, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * 解析 changeset 文件，提取 bump 类型和摘要
 */
function parseChangeset(filepath: string): { bump: string, summary: string } | null {
  const content = fs.readFileSync(filepath, 'utf-8')
  const match = content.match(/^---\n"[^"]+":\s*(\w+)\n---\n\n([\s\S]*)$/)
  if (!match)
    return null
  return { bump: match[1], summary: match[2].trim() }
}

/** 计算 semver 下一个版本号 */
function nextVersion(version: string, bump: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  if (bump === 'major')
    return `${major + 1}.0.0`
  if (bump === 'minor')
    return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * 交互式确认/覆盖版本升级类型。
 */
async function resolveBumpType(
  files: string[],
  changesetDir: string,
  oldVersion: string,
): Promise<string> {
  const entries: { file: string, bump: string, summary: string }[] = []
  for (const f of files) {
    const parsed = parseChangeset(path.join(changesetDir, f))
    if (parsed) {
      entries.push({ file: f, ...parsed })
    }
  }

  if (entries.length === 0)
    return 'patch'

  // 计算自动检测到的最高 bump
  const autoBump = entries
    .map(e => e.bump)
    .reduce((max, b) => bumpPriority(b) > bumpPriority(max) ? b : max, 'patch')

  // emoji 标记
  const bumpEmoji: Record<string, string> = { major: '💥', minor: '✨', patch: '🐛' }
  const emoji = (b: string) => bumpEmoji[b] || '🔧'

  // 展示摘要
  console.log(`\n${'-'.repeat(50)}`)
  console.log(`  待发布的 changeset (${entries.length} 个):\n`)
  for (const e of entries) {
    const line = e.summary.length > 72 ? `${e.summary.slice(0, 72)}...` : e.summary
    console.log(`    ${emoji(e.bump)} [${e.bump}] ${line}`)
  }
  console.log(`\n  检测到版本升级: ${autoBump}  (v${oldVersion} -> v${nextVersion(oldVersion, autoBump)})`)
  console.log('-'.repeat(50))

  // 询问用户
  const answer = await question(
    `\n  确认版本升级类型? [回车=使用 ${autoBump} / 输入 major|minor|patch 覆盖]: `,
  )
  const choice = answer.trim().toLowerCase()

  if (choice === '') {
    log(`使用自动检测的 bump 类型: ${autoBump}`)
    return autoBump
  }

  if (choice === 'major' || choice === 'minor' || choice === 'patch') {
    if (choice !== autoBump) {
      log(`覆盖 bump 类型: ${autoBump} → ${choice}`)
      // 修改所有 changeset 文件的 YAML frontmatter
      for (const e of entries) {
        if (e.bump === choice)
          continue
        const filepath = path.join(changesetDir, e.file)
        const content = fs.readFileSync(filepath, 'utf-8')
        const updated = content.replace(
          /^("[^"]+":\s*)\w+(\s*\n---)/m,
          `$1${choice}$2`,
        )
        fs.writeFileSync(filepath, updated, 'utf-8')
      }
    }
    return choice
  }

  log(`无效输入 '${choice}'，使用自动检测: ${autoBump}`)
  return autoBump
}

function ensureMainBranch() {
  const branch = run('git rev-parse --abbrev-ref HEAD')
  if (branch !== 'main') {
    log(`❌ 只能在 main 分支执行发版，当前分支: ${branch}`)
    process.exit(1)
  }
}

/**
 * 检测上次 git push 失败的遗留状态。
 */
function handleFailedPushResume(pkgPath: string, changesetDir: string): boolean {
  const currentPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const currentVersion: string = currentPkg.version
  const currentTag = `v${currentVersion}`

  // 检查本地 tag 是否存在
  let localTagExists = false
  try {
    run(`git rev-parse ${currentTag}`)
    localTagExists = true
  }
  catch {
    localTagExists = false
  }

  if (!localTagExists)
    return false

  // 检查是否有待消费的 changeset
  const changesetFiles = fs.readdirSync(changesetDir).filter(
    f => f.endsWith('.md') && f !== 'README.md',
  )
  if (changesetFiles.length > 0)
    return false

  // 检查远端 tag 是否存在
  let remoteTagExists = false
  try {
    const refs = run(`git ls-remote --tags origin ${currentTag}`)
    if (refs)
      remoteTagExists = true
  }
  catch {
    remoteTagExists = false
  }

  // 远端已存在该 tag → 版本已发布完成，正常放行
  if (remoteTagExists)
    return false

  // 本地有 tag 但远端没有、且无待消费 changeset → 上次 push 失败，恢复推送
  log(`⚠️  检测到本地存在未推送的标签 ${currentTag}，跳过版本升级，直接推送...`)
  const branch = run('git rev-parse --abbrev-ref HEAD')

  log(`推送分支 ${branch}...`)
  run(`git push origin ${branch}`)

  log(`推送标签 ${currentTag}...`)
  try {
    run(`git push origin ${currentTag}`)
  }
  catch (err: any) {
    log(`❌ 推送标签失败: ${err.message}`)
    log('请检查网络后重新运行 pnpm release，将自动恢复推送。')
    process.exit(1)
  }

  log(`✅ 发版完成: ${currentTag}`)
  process.exit(0)
}

async function main() {
  ensureMainBranch()
  const pkgPath = path.resolve('apps/admin/package.json')
  const changesetDir = path.resolve('.changeset')

  // 检查是否是上次 push 失败的恢复场景
  handleFailedPushResume(pkgPath, changesetDir)

  // 1. 检查是否有待消费的 changeset，无则自动从 git commit 生成
  let files = fs.readdirSync(changesetDir).filter(f => f.endsWith('.md') && f !== 'README.md')
  if (files.length === 0) {
    log('没有待消费的 changeset，尝试从 git commit 自动生成...')
    run('walnut-auto-changeset')
    files = fs.readdirSync(changesetDir).filter(f => f.endsWith('.md') && f !== 'README.md')
    if (files.length === 0) {
      log('没有可生成的变更记录，跳过发版')
      process.exit(0)
    }
  }

  log(`发现 ${files.length} 个待消费 changeset`)

  // 2. 交互式确认版本升级类型
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const oldVersion = pkg.version
  await resolveBumpType(files, changesetDir, oldVersion)

  // 3. 消费 changesets，更新版本号（fixed 组自动同步所有包）
  log('消费 changesets，更新版本号...')
  run('pnpm changeset version')

  // 4. 读取新版本号
  const newPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const newVersion = newPkg.version

  if (oldVersion === newVersion) {
    log('版本号未变更，跳过发版')
    process.exit(0)
  }

  log(`版本: v${oldVersion} → v${newVersion}`)

  // 5. 用 git-cliff 生成 CHANGELOG.md
  log('生成 CHANGELOG.md (git-cliff)...')
  try {
    run('pnpm changelog')
    log('CHANGELOG.md 已更新')
  }
  catch (err: any) {
    log(`⚠️  git-cliff 执行失败: ${err.message}`)
    log('继续发版流程（可稍后手动生成 CHANGELOG）')
  }

  // 6. git 提交版本变更
  log('提交版本变更...')
  run('git add .')
  try {
    run(`git commit -m "chore: release v${newVersion}"`)
  }
  catch {
    log('没有需要提交的变更')
  }

  // 7. 创建 tag
  const tagName = `v${newVersion}`
  log(`创建标签: ${tagName}`)
  run(`git tag -a ${tagName} -m "${tagName}"`)

  // 8. 推送
  const branch = run('git rev-parse --abbrev-ref HEAD')
  log(`推送分支 ${branch} 和标签...`)
  run(`git push origin ${branch}`)
  run(`git push origin ${tagName}`)

  log(`发版完成: ${tagName}`)
}

main().catch((err) => {
  console.error('\x1B[31m[release]\x1B[0m', err.message)
  process.exit(1)
})
