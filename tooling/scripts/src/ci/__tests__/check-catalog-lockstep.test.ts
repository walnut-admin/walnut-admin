import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectFindings,
  compareCatalogs,
  isExactVersion,
  parseDeclaredCatalog,
  parseLockedCatalog,
  parseLockedOverrides,
  readHeadBlob,
  topLevelSection,
} from '../check-catalog-lockstep.ts'

function findRoot(start: string): string {
  let dir = path.resolve(start)
  for (;;) {
    if (
      path.basename(dir) === 'walnut-admin' &&
      path.basename(path.dirname(dir)) === 'walnut-admin'
    )
      return dir
    const up = path.dirname(dir)
    if (up === dir) throw new Error(`从 ${start} 向上找不到仓库根`)
    dir = up
  }
}
const ROOT = findRoot(process.cwd())

describe('topLevelSection', () => {
  it('取到下一个顶层键为止', () => {
    const sec = topLevelSection('a:\n  x: 1\nb:\n  y: 2\n', 'a')
    expect(sec?.lines).toEqual(['  x: 1'])
  })

  it('`last` 取最后一次出现（两段式 YAML 的关键）', () => {
    const sec = topLevelSection('k:\n  first: 1\nother:\nk:\n  second: 2\n', 'k', 'last')
    // 最后一次出现一直延伸到文件末，所以会带上结尾的空行 —— 不是问题，
    // 下面两个解析器都只按行正则取值
    expect(sec?.lines.filter((l) => l.trim() !== '')).toEqual(['  second: 2'])
  })
})

describe('parseDeclaredCatalog', () => {
  it('剥掉包名两侧的引号', () => {
    // 这条是实测踩出来的：不剥引号时 243 条里会误报 97 条（catalog 里
    // `'@scope/name': 1.0.0` 是常见写法，而锁文件那侧本来就不带引号）
    const m = parseDeclaredCatalog("catalog:\n  '@a/b': 1.0.0\n  plain: 2.0.0\n")
    expect([...m.entries()]).toEqual([
      ['@a/b', '1.0.0'],
      ['plain', '2.0.0'],
    ])
  })

  it('注释与空行不算条目', () => {
    const m = parseDeclaredCatalog('catalog:\n  # 注释\n\n  a: 1.0.0\n')
    expect([...m.keys()]).toEqual(['a'])
  })

  it('没有 catalog 段时返回空', () => {
    expect(parseDeclaredCatalog('packages:\n  - "apps/*"\n').size).toBe(0)
  })
})

describe('parseLockedCatalog', () => {
  it('从 `catalogs.default` 下取 specifier / version', () => {
    const m = parseLockedCatalog(
      "catalogs:\n  default:\n    '@a/b':\n      specifier: 1.0.0\n      version: 1.0.0\n",
    )
    expect(m.get('@a/b')).toEqual({ specifier: '1.0.0', version: '1.0.0' })
  })

  it('两段式锁文件里只认第二段（第一段是根桩）', () => {
    // 模拟：第一段有个同名但内容不同的 catalogs，第二段才是真的
    const text = [
      'catalogs:',
      '  default:',
      '    a:',
      '      specifier: 0.0.1',
      '      version: 0.0.1',
      'packages:',
      '  x: 1',
      'catalogs:',
      '  default:',
      '    a:',
      '      specifier: 9.9.9',
      '      version: 9.9.9',
      '',
    ].join('\n')
    expect(parseLockedCatalog(text).get('a')?.version).toBe('9.9.9')
  })
})

describe('parseLockedOverrides', () => {
  it('从顶层 overrides: 取包名到覆盖值，剥引号', () => {
    const m = parseLockedOverrides(
      "catalogs:\n  default:\n    a:\n      specifier: 1.0.0\n      version: 1.0.0\noverrides:\n  typescript: npm:typescript-native-bridge@6.0.3\n  'quoted': 2.0.0\n",
    )
    expect([...m.entries()]).toEqual([
      ['typescript', 'npm:typescript-native-bridge@6.0.3'],
      ['quoted', '2.0.0'],
    ])
  })

  it('没有 overrides: 段时返回空', () => {
    expect(parseLockedOverrides('catalogs:\n  default:\n    a: {}\n').size).toBe(0)
  })
})

describe('isExactVersion', () => {
  it('精确版本为真，范围写法为假', () => {
    expect(isExactVersion('1.2.3')).toBe(true)
    expect(isExactVersion('1.2.3-beta.1')).toBe(true)
    for (const r of ['^1.2.3', '~1.2.3', '>=1.0.0', '<2', '1.x', '*', '1 || 2'])
      expect(isExactVersion(r), r).toBe(false)
  })
})

describe('compareCatalogs（纯函数）', () => {
  const ws = 'catalog:\n  a: 1.0.0\n  b: 2.0.0\n'
  const lockOk = [
    'catalogs:',
    '  default:',
    '    a:',
    '      specifier: 1.0.0',
    '      version: 1.0.0',
    '    b:',
    '      specifier: 2.0.0',
    '      version: 2.0.0',
    '',
  ].join('\n')

  it('一致时没有发现', () => {
    expect(compareCatalogs(ws, lockOk)).toEqual([])
  })

  it('声明改了、锁文件没跟上 ⇒ 报出是哪一条（这正是 CI 只报「lockfile 不是最新」时缺的信息）', () => {
    const stale = lockOk
      .replace('specifier: 1.0.0', 'specifier: 0.9.0')
      .replace('version: 1.0.0', 'version: 0.9.0')
    const f = compareCatalogs(ws, stale)
    expect(f.map((x) => x.rule)).toEqual(['catalog-lockstep', 'catalog-lockstep'])
    expect(f[0]!.detail).toContain('`a`')
  })

  it('锁文件里有、catalog 删了 ⇒ 也报', () => {
    const extra = `${lockOk}    c:\n      specifier: 3.0.0\n      version: 3.0.0\n`
    expect(compareCatalogs(ws, extra).some((f) => f.detail.includes('`c`'))).toBe(true)
  })

  it('范围写法不做版本比对（否则必误报）', () => {
    const ranged = 'catalog:\n  a: ^1.0.0\n'
    const lock = 'catalogs:\n  default:\n    a:\n      specifier: ^1.0.0\n      version: 1.4.2\n'
    expect(compareCatalogs(ranged, lock)).toEqual([])
  })

  it('catalog 条目被同名 override 覆盖（pnpm 不写 catalogs: 段）⇒ 视为已锁定，绿', () => {
    // 2026-11-28 的 typescript（TNB 转正）就是这个形态：catalog 里有，锁文件
    // catalogs: 段没有、overrides: 段有同名同值条目。旧判据在这里误报「锁文件里没有」。
    const ws2 = 'catalog:\n  a: 1.0.0\n  typescript: npm:typescript-native-bridge@6.0.3\n'
    const lock = [
      'catalogs:',
      '  default:',
      '    a:',
      '      specifier: 1.0.0',
      '      version: 1.0.0',
      'overrides:',
      '  typescript: npm:typescript-native-bridge@6.0.3',
      '',
    ].join('\n')
    expect(compareCatalogs(ws2, lock)).toEqual([])
  })

  it('同名 override 的值与 catalog 声明不一致 ⇒ 仍判红（override 不豁免锁步比对）', () => {
    const ws2 = 'catalog:\n  a: 1.0.0\n  typescript: npm:typescript-native-bridge@6.0.3\n'
    const stale = [
      'catalogs:',
      '  default:',
      '    a:',
      '      specifier: 1.0.0',
      '      version: 1.0.0',
      'overrides:',
      '  typescript: npm:typescript-native-bridge@5.9.0',
      '',
    ].join('\n')
    const f = compareCatalogs(ws2, stale)
    expect(f.map((x) => x.rule)).toEqual(['catalog-lockstep'])
    expect(f[0]!.detail).toContain('`typescript`')
    expect(f[0]!.detail).toContain('同名 override')
  })

  it('catalog 条目既不在 catalogs: 也不在 overrides: ⇒ 仍判红（覆盖不是豁免）', () => {
    const ws2 = 'catalog:\n  a: 1.0.0\n  typescript: npm:typescript-native-bridge@6.0.3\n'
    const lockAOnly = [
      'catalogs:',
      '  default:',
      '    a:',
      '      specifier: 1.0.0',
      '      version: 1.0.0',
      '',
    ].join('\n')
    const f = compareCatalogs(ws2, lockAOnly)
    expect(f.map((x) => x.rule)).toEqual(['catalog-lockstep'])
    expect(f[0]!.detail).toContain('`typescript`')
    expect(f[0]!.detail).toContain('锁文件里没有')
  })

  it('解析不出来时按前置条件报错，不静默通过', () => {
    expect(compareCatalogs('packages:\n  - x\n', lockOk).map((f) => f.rule)).toEqual([
      'precondition',
    ])
    expect(compareCatalogs(ws, 'packages:\n  - x\n').map((f) => f.rule)).toEqual(['precondition'])
  })
})

describe('collectFindings（比对 HEAD 里那一对）', () => {
  it('hEAD 里的 catalog 与锁文件锁步', () => {
    expect(collectFindings(ROOT).map((f) => `${f.rule} :: ${f.detail}`)).toEqual([])
  })

  it('hEAD 里那一对是**两段式锁文件**也能解析（只认第二段的 catalogs）', () => {
    const lock = readHeadBlob('pnpm-lock.yaml', ROOT)!
    const declared = parseDeclaredCatalog(readHeadBlob('pnpm-workspace.yaml', ROOT)!)
    const locked = parseLockedCatalog(lock)
    const overrides = parseLockedOverrides(lock)
    expect(declared.size).toBeGreaterThan(100)
    // 被同名 override 覆盖的条目按 pnpm 的锁文件形态**不在** catalogs: 段，
    // 所以不变量是「每个声明都能在 catalogs: 或 overrides: 里找到」，不是 size 严格相等
    expect([...declared.keys()].filter((k) => !locked.has(k) && !overrides.has(k))).toEqual([])
    expect(locked.size).toBeGreaterThan(100)
  })

  it('读不到 HEAD 时按前置条件报错（不是静默通过）', () => {
    // 必须用**仓库之外**的目录：`git show` 会向上找仓库根，传仓内子目录照样读得到
    // （那是好行为 —— 门禁对 cwd 不敏感）。第一次拿 `apps/docs` 当反例，测试就假失败了。
    expect(collectFindings(tmpdir()).map((f) => f.rule)).toContain('precondition')
  })
})
