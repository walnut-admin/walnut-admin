import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpPriority, handleFailedPushResume, main, nextVersion, parseChangeset, resolveBumpType } from './release'

// hoisted：mock 工厂与测试共享的调用记录 + 可替换的 mock 行为
const { execCalls, setExecMock } = vi.hoisted(() => {
  const execCalls: string[] = []
  const setExecMock: { fn: (cmd: string) => string } = { fn: () => '' }
  return { execCalls, setExecMock }
})

// mock 所有外部命令，按命令内容分派行为（见 setExecMock.fn）
// 返回值 '__THROW__' 表示模拟命令执行失败；直接返回 string（run() 内会 .toString()）
vi.mock('node:child_process', () => ({
  execSync: (cmd: unknown) => {
    const c = String(cmd)
    execCalls.push(c)
    const result = setExecMock.fn(c)
    if (result === '__THROW__')
      throw new Error('mock exec error')
    return result
  },
}))

let tempDir = ''
let originalCwd = ''
let fileSeq = 0

function writeTemp(content: string): string {
  fileSeq++
  const p = path.join(tempDir, `cs-${fileSeq}.md`)
  fs.writeFileSync(p, content, 'utf-8')
  return p
}

/** 阻止 process.exit 真的退出测试进程 */
function mockProcessExit() {
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit was called')
  }) as never)
}

describe('bumpPriority / nextVersion', () => {
  it('优先级 major > minor > patch', () => {
    expect(bumpPriority('major')).toBe(3)
    expect(bumpPriority('minor')).toBe(2)
    expect(bumpPriority('patch')).toBe(1)
    expect(bumpPriority('unknown')).toBe(1)
  })

  it('semver 递增', () => {
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('2.0.0', 'minor')).toBe('2.1.0')
  })
})

describe('parseChangeset', () => {
  it('解析单包 frontmatter', () => {
    const f = writeTemp('---\n"@walnut/server": patch\n---\n\n修复事务回滚')
    expect(parseChangeset(f)).toEqual({ bump: 'patch', summary: '修复事务回滚' })
  })

  it('解析多包 frontmatter（auto 生成格式），bump 取最高', () => {
    const f = writeTemp('---\n"@walnut/admin": minor\n"@walnut/utils": minor\n---\n\nabc123 ::: feat ::: add login')
    expect(parseChangeset(f)).toEqual({ bump: 'minor', summary: 'abc123 ::: feat ::: add login' })
  })

  it('bump 类型混合时取最高', () => {
    const f = writeTemp('---\n"@walnut/admin": patch\n"@walnut/utils": major\n---\n\nx')
    expect(parseChangeset(f)?.bump).toBe('major')
  })

  it('无 frontmatter → null', () => {
    const f = writeTemp('plain text without frontmatter')
    expect(parseChangeset(f)).toBeNull()
  })
})

describe('resolveBumpType（非交互环境 → 自动检测）', () => {
  let dir: string

  beforeEach(() => {
    // 独立临时目录，避免与 parseChangeset 测试的临时文件互相污染
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-bump-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockProcessExit()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('无有效 changeset → 默认 patch', async () => {
    expect(await resolveBumpType([], dir, '1.0.0')).toBe('patch')
  })

  it('多个 changeset 取最高 bump', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '---\n"@walnut/admin": patch\n---\n\nfix a')
    fs.writeFileSync(path.join(dir, 'b.md'), '---\n"@walnut/admin": minor\n---\n\nfeat b')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    expect(await resolveBumpType(files, dir, '1.0.0')).toBe('minor')
  })

  it('含 major 的 changeset 优先', async () => {
    fs.writeFileSync(path.join(dir, 'a.md'), '---\n"@walnut/admin": minor\n---\n\nfeat a')
    fs.writeFileSync(path.join(dir, 'b.md'), '---\n"@walnut/admin": major\n---\n\nbreaking b')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    expect(await resolveBumpType(files, dir, '1.0.0')).toBe('major')
  })
})

describe('main() 完整发版流程（mock 外部命令）', () => {
  let dir: string
  let pkgPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-flow-'))
    pkgPath = path.join(dir, 'apps/admin/package.json')
    fs.mkdirSync(path.join(dir, 'apps/admin'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.changeset'), { recursive: true })
    fs.writeFileSync(pkgPath, JSON.stringify({ name: '@walnut/admin', version: '0.9.0' }))
    fs.writeFileSync(
      path.join(dir, '.changeset/auto-test.md'),
      '---\n"@walnut/admin": minor\n"@walnut/utils": minor\n---\n\nabc123 ::: feat ::: add login',
    )
    execCalls.length = 0

    // 默认 mock：main 分支、其余命令成功返回空
    setExecMock.fn = (cmd) => {
      if (cmd.startsWith('git rev-parse v'))
        return '__THROW__' // 本地无该 tag → 跳过 handleFailedPushResume 恢复路径
      if (cmd.includes('rev-parse --abbrev-ref'))
        return 'main'
      if (cmd.includes('pnpm changeset version')) {
        // 模拟版本落地：将 admin 0.9.0 minor → 0.10.0
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        pkg.version = nextVersion(pkg.version, 'minor')
        fs.writeFileSync(pkgPath, JSON.stringify(pkg))
        return ''
      }
      return ''
    }

    process.chdir(dir)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockProcessExit()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.chdir(originalCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('完整流程：changeset version → commit → tag → push', async () => {
    await main()

    expect(execCalls).toContain('pnpm changeset version')
    expect(execCalls).toContain('git add .')
    expect(execCalls).toContain('git commit -m "chore: release v0.10.0"')
    // tag 命令带 -m 后缀：git tag -a v0.10.0 -m "v0.10.0"
    expect(execCalls.some(c => c.startsWith('git tag -a v0.10.0'))).toBe(true)
    expect(execCalls).toContain('git push origin main')
    expect(execCalls).toContain('git push origin v0.10.0')
  })

  it('非 main 分支拒绝发版', async () => {
    setExecMock.fn = cmd => (cmd.includes('rev-parse --abbrev-ref') ? 'dev' : '')
    await expect(main()).rejects.toThrow('process.exit was called')
    expect(execCalls).not.toContain('pnpm changeset version')
  })

  it('版本号未变更时跳过发版（不 push）', async () => {
    setExecMock.fn = cmd => (cmd.includes('rev-parse --abbrev-ref') ? 'main' : '')
    // 版本号未变更 → process.exit(0)，被 spy 转成 reject
    await expect(main()).rejects.toThrow('process.exit was called')
    expect(execCalls.some(c => c.includes('git push'))).toBe(false)
  })

  it('无待消费 changeset 时尝试自动生成，仍无则跳过', async () => {
    fs.rmSync(path.join(dir, '.changeset/auto-test.md'))
    setExecMock.fn = (cmd) => {
      if (cmd.startsWith('git rev-parse v'))
        return '__THROW__' // 本地无该 tag → 跳过恢复路径
      if (cmd.includes('rev-parse --abbrev-ref'))
        return 'main'
      return ''
    }
    await expect(main()).rejects.toThrow('process.exit was called')
    expect(execCalls).toContain('walnut-auto-changeset')
    expect(execCalls.some(c => c.includes('git push'))).toBe(false)
  })
})

describe('handleFailedPushResume 恢复路径', () => {
  it('本地有 tag、无待消费 changeset、远端无 tag → 恢复推送', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-resume-'))
    const pkgPath = path.join(dir, 'apps/admin/package.json')
    fs.mkdirSync(path.join(dir, 'apps/admin'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.changeset'), { recursive: true })
    fs.writeFileSync(pkgPath, JSON.stringify({ name: '@walnut/admin', version: '0.5.0' }))

    execCalls.length = 0
    setExecMock.fn = (cmd) => {
      if (cmd.includes('rev-parse --abbrev-ref'))
        return 'main'
      if (cmd.includes('ls-remote --tags'))
        return ''
      return ''
    }

    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockProcessExit()

    // git rev-parse v0.5.0 返回空 → 本地 tag 存在；.changeset 无文件 → 无待消费；远端无 → 恢复推送
    // 恢复完成后 process.exit(0)，被 spy 转成 throw
    expect(() => handleFailedPushResume(pkgPath, path.join(dir, '.changeset'))).toThrow('process.exit was called')
    expect(execCalls).toContain('git push origin main')
    expect(execCalls).toContain('git push origin v0.5.0')

    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('远端已存在该 tag → 正常放行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-resume-'))
    const pkgPath = path.join(dir, 'apps/admin/package.json')
    fs.mkdirSync(path.join(dir, 'apps/admin'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.changeset'), { recursive: true })
    fs.writeFileSync(pkgPath, JSON.stringify({ name: '@walnut/admin', version: '0.5.0' }))

    execCalls.length = 0
    setExecMock.fn = (cmd) => {
      if (cmd.includes('ls-remote --tags'))
        return 'v0.5.0'
      return ''
    }

    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(handleFailedPushResume(pkgPath, path.join(dir, '.changeset'))).toBe(false)
    expect(execCalls.some(c => c.includes('git push'))).toBe(false)

    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-unit-'))
  originalCwd = process.cwd()
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})
