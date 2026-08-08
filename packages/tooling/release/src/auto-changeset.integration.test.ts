import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './auto-changeset'

/**
 * 集成测试：在系统临时目录创建全新 git 仓库（与真实仓库完全隔离），
 * 提交若干 conventional commits 后真跑 auto-changeset 的 main()。
 */

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()
}

function changesetFiles(dir: string): string[] {
  const csDir = path.join(dir, '.changeset')
  if (!fs.existsSync(csDir))
    return []
  return fs.readdirSync(csDir).filter(f => f.endsWith('.md') && f !== 'README.md')
}

describe('auto-changeset 集成（真实 git 仓库）', () => {
  let dir = ''
  let originalCwd = ''

  const commit = (msg: string, files: Record<string, string>) => {
    for (const [f, content] of Object.entries(files)) {
      const p = path.join(dir, f)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, content)
    }
    git('git add .', dir)
    git(`git commit -m "${msg}"`, dir)
  }

  beforeAll(() => {
    originalCwd = process.cwd()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walnut-ac-'))
    git('git init -b main', dir)
    git('git config user.email test@walnut.dev', dir)
    git('git config user.name test', dir)
  })

  afterAll(() => {
    process.chdir(originalCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('按 scope 归因包：feat(admin)→minor、fix(server)→patch、breaking→major、无 scope 兜底两组', () => {
    commit('feat(admin): add remember me', { 'apps/admin/src/a.ts': 'x' })
    commit('fix(server): fix bug', { 'apps/server/src/b.ts': 'y' })
    commit('feat(admin)!: breaking change', { 'apps/admin/src/c.ts': 'z' })
    commit('fix: legacy no-scope fix', { 'apps/admin/src/d.ts': 'w' })
    commit('chore(deps): bump deps', { 'apps/admin/package.json': '{}' })
    commit('docs(admin): update guide', { 'docs/guide.md': 'd' })

    fs.mkdirSync(path.join(dir, '.changeset'))
    process.chdir(dir)
    main()

    const files = changesetFiles(dir)
    expect(files).toHaveLength(4)

    const contents = files.map(f => fs.readFileSync(path.join(dir, '.changeset', f), 'utf-8'))
    // scoped：feat(admin) → 只提及 @walnut/admin，不带 utils
    const minor = contents.find(c => c.includes('"@walnut/admin": minor'))
    expect(minor).toBeDefined()
    expect(minor).not.toContain('"@walnut/utils"')
    // scoped：fix(server) → 只提及 @walnut/server
    expect(contents.some(c => c.includes('"@walnut/server": patch'))).toBe(true)
    // breaking major
    expect(contents.some(c => c.includes('"@walnut/admin": major'))).toBe(true)
    // 无 scope 兜底：同时提及 admin + utils 两个组代表
    const fallback = contents.find(c => c.includes('"@walnut/utils"'))
    expect(fallback).toBeDefined()
    expect(fallback).toContain('"@walnut/admin"')
    // summary 为纯人类可读描述（不带 scope 前缀）
    expect(contents.some(c => c.includes('\n\nadd remember me'))).toBe(true)

    // 幂等：重复执行不重复生成
    main()
    expect(changesetFiles(dir)).toHaveLength(4)
  })

  it('已有 tag 时只扫描 tag 之后的 commits', () => {
    git('git tag v0.1.0', dir)
    commit('fix(server): post-tag fix', { 'apps/server/src/e.ts': 'v' })

    main()
    const files = changesetFiles(dir)
    // 前一个用例 4 个 + 本次 1 个
    expect(files).toHaveLength(5)
  })
})
