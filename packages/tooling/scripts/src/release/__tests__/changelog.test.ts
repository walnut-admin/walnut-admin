/**
 * 逐包 CHANGELOG 的渲染参数与拼装（纯逻辑 + 参数构造）。
 *
 * 两条硬规则（changelog.ts 注释）：段落标题永远带版本；写入幂等（已有该版本段就跳过）。
 * 另外 `outsidePackagePatterns` 的两种粒度不能退化成「一律 `<顶层段>/**`」——
 * 那会让 server 的提交同时出现在 admin 的 changelog 里（跨包重复）。
 */

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  CLIFF_CONFIG_PATH,
  cliffArgsForChangelog,
  cliffArgsForReleaseNotes,
  composeChangelog,
  excludePathsFor,
  hasEntries,
  hasVersionSection,
  includePathsFor,
  normalizeRendered,
  outsidePackagePatterns,
} from '../changelog.ts'

/** 真实仓库里的包目录形状：`apps/<x>` + 更深一层的 `packages/<group>/<x>` */
const PACKAGE_DIRS = ['apps/admin', 'apps/server', 'packages/tooling/scripts', 'packages/platform-any/utils-core']

const TRACKED_FILES = [
  'apps/README.md',
  'apps/server/src/main.ts',
  'packages/README.md',
  'packages/tooling/scripts/src/release/plan.ts',
  '.github/workflows/ci.yml',
  'deploy/docker/backend.Dockerfile',
  'cliff.toml',
  'turbo.json',
]

describe('outsidePackagePatterns —— 包外路径的两种粒度', () => {
  it('顶层段里**住着**包目录 ⇒ 退化到文件本身（写成 `apps/**` 会把 apps/server 也扫进来）', () => {
    const patterns = outsidePackagePatterns(PACKAGE_DIRS, TRACKED_FILES)
    expect(patterns).toContain('apps/README.md')
    expect(patterns).toContain('packages/README.md')
    expect(patterns).not.toContain('apps/**')
    expect(patterns).not.toContain('packages/**')
  })

  it('顶层段里**没有**包目录 ⇒ 整段纳入 `<顶层段>/**`', () => {
    const patterns = outsidePackagePatterns(PACKAGE_DIRS, TRACKED_FILES)
    expect(patterns).toContain('deploy/**')
    expect(patterns).toContain('.github/**')
  })

  it('没有斜杠的根文件原样纳入', () => {
    const patterns = outsidePackagePatterns(PACKAGE_DIRS, TRACKED_FILES)
    expect(patterns).toContain('cliff.toml')
    expect(patterns).toContain('turbo.json')
  })

  it('落在包目录里的文件被跳过，结果是排序稳定的去重集合', () => {
    expect(outsidePackagePatterns(PACKAGE_DIRS, TRACKED_FILES)).toEqual([
      '.github/**',
      'apps/README.md',
      'cliff.toml',
      'deploy/**',
      'packages/README.md',
      'turbo.json',
    ])
  })

  it('没有包目录时（退化输入）不会把根文件当目录', () => {
    expect(outsidePackagePatterns([], ['turbo.json', 'apps/admin/package.json'])).toEqual(['apps/**', 'turbo.json'])
  })
})

describe('includePathsFor / excludePathsFor', () => {
  it('只有主应用额外带上「包外路径」', () => {
    expect(includePathsFor('apps/admin', ['turbo.json', 'deploy/**'], 'apps/admin')).toEqual(['apps/admin/**', 'turbo.json', 'deploy/**'])
    expect(includePathsFor('apps/server', ['turbo.json'], 'apps/admin')).toEqual(['apps/server/**'])
    expect(includePathsFor('packages/tooling/scripts', [], 'apps/admin')).toEqual(['packages/tooling/scripts/**'])
  })

  it('排除住得更深的嵌套包（否则父子包的 changelog 会跨包重复）', () => {
    const allDirs = ['apps/admin', 'packages/tooling/scripts', 'packages/tooling/scripts/nested', 'packages/tooling/scripts/nested/deeper']
    expect(excludePathsFor('packages/tooling/scripts', allDirs)).toEqual(['packages/tooling/scripts/nested/**', 'packages/tooling/scripts/nested/deeper/**'])
    expect(excludePathsFor('apps/admin', allDirs)).toEqual([])
    // 自己不是自己的嵌套包；同级的兄弟目录也不算
    expect(excludePathsFor('packages/tooling/scripts/nested', allDirs)).toEqual(['packages/tooling/scripts/nested/deeper/**'])
    expect(excludePathsFor('packages/tooling/scripts', ['packages/tooling/scripts', 'apps/admin'])).toEqual([])
  })
})

describe('normalizeRendered', () => {
  it('去首尾空白 + 把 3 个以上连续换行压成 2 个', () => {
    expect(normalizeRendered('  a\n\n\n\nb  \n\n')).toBe('a\n\nb')
    expect(normalizeRendered('\n\n## 1.0.0\n\n- x\n\n')).toBe('## 1.0.0\n\n- x')
    expect(normalizeRendered('a\n\nb')).toBe('a\n\nb')
    expect(normalizeRendered('')).toBe('')
  })
})

describe('composeChangelog —— 一级标题恰好处理一次', () => {
  const header = '# @walnut/admin'
  const section = '## 1.1.0\n\n- new'
  /** 三种旧内容形态拼出来的结果必须逐字相同（都是「标题 + 新段 + 旧段」） */
  const EXPECTED = '# @walnut/admin\n\n## 1.1.0\n\n- new\n\n## 1.0.0\n\n- old\n'

  it('旧内容的一级标题与期望逐字相同 ⇒ 剥掉它再重写', () => {
    expect(composeChangelog({ existing: '# @walnut/admin\n\n## 1.0.0\n\n- old\n', header, section })).toBe(EXPECTED)
  })

  it('旧内容的一级标题是**别的**标题（包改名 / 历史格式）⇒ 用期望标题替换它', () => {
    expect(composeChangelog({ existing: '# Old Name\n\n## 1.0.0\n\n- old\n', header, section })).toBe(EXPECTED)
  })

  it('旧内容没有一级标题 ⇒ 原样接在后面', () => {
    expect(composeChangelog({ existing: '## 1.0.0\n\n- old\n', header, section })).toBe(EXPECTED)
  })

  it('文件不存在（空串）⇒ 只写标题 + 新段', () => {
    expect(composeChangelog({ existing: '', header, section })).toBe('# @walnut/admin\n\n## 1.1.0\n\n- new\n')
  })

  it('旧内容只有空白 ⇒ 也不留多余空段', () => {
    expect(composeChangelog({ existing: '\n\n\n', header, section })).toBe('# @walnut/admin\n\n## 1.1.0\n\n- new\n')
  })

  it('结果里的一级标题恰好一个（两个 H1 会让面板认错包名）', () => {
    const composed = composeChangelog({ existing: '# Old Name\n\n## 1.0.0\n\n- old\n', header, section })
    expect(composed.split('\n').filter(line => line.startsWith('# '))).toEqual(['# @walnut/admin'])
  })
})

describe('hasVersionSection / hasEntries', () => {
  it('幂等判据与抽段用的是同一个函数（逐字 `## <版本>`）', () => {
    expect(hasVersionSection('# @walnut/admin\n\n## 1.1.0\n\n- x\n', '1.1.0')).toBe(true)
    expect(hasVersionSection('# @walnut/admin\n\n## [1.1.0]\n\n- x\n', '1.1.0')).toBe(false)
    expect(hasVersionSection('', '1.1.0')).toBe(false)
  })

  it('只有标题 / 空段 ⇒ 这次该包没有条目', () => {
    expect(hasEntries('## 1.1.0\n\n- 一条\n- 两条')).toBe(true)
    expect(hasEntries('## 1.1.0')).toBe(false)
    expect(hasEntries('## 1.1.0\n\n### 分组\n')).toBe(false)
    // 缩进的 `- ` 不算条目（模板里条目都顶格）
    expect(hasEntries('## 1.1.0\n\n  - 缩进的\n')).toBe(false)
  })
})

describe('git-cliff 参数构造', () => {
  it('配置路径指向仓库根的 cliff.toml', () => {
    expect(CLIFF_CONFIG_PATH).toBe(path.join(REPO_ROOT, 'cliff.toml'))
  })

  it('changelog 用参数：未打 tag 的提交 + 指定版本 + 配置 + 纳入/排除模式', () => {
    expect(cliffArgsForChangelog({
      version: '1.2.3',
      includePaths: ['apps/admin/**', 'turbo.json'],
      excludePaths: ['apps/admin/nested/**'],
    })).toEqual([
      '--unreleased',
      '--tag',
      'v1.2.3',
      '--config',
      CLIFF_CONFIG_PATH,
      '--include-path',
      'apps/admin/**',
      '--include-path',
      'turbo.json',
      '--exclude-path',
      'apps/admin/nested/**',
    ])
  })

  it('changelog 用参数在缺省 excludePaths 时不带任何 exclude-path', () => {
    const args = cliffArgsForChangelog({ version: '1.2.3', includePaths: ['apps/admin/**'] })
    expect(args).toContain('--unreleased')
    expect(args).toContain('v1.2.3')
    expect(args).not.toContain('--exclude-path')
  })

  it('release 正文用参数：整仓一份，**不带** include-path（天然无跨包重复）', () => {
    const args = cliffArgsForReleaseNotes('1.2.3')
    expect(args).toEqual(['--unreleased', '--tag', 'v1.2.3', '--config', CLIFF_CONFIG_PATH])
    expect(args).not.toContain('--include-path')
    expect(args).not.toContain('--exclude-path')
  })
})
