import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  collectFindings,
  declaredOutDirs,
  globMatchesSomething,
  loadTurboDry,
  nestOutDir,
  packageDirs,
  readTurboJson,
} from '../check-turbo-cache.ts'

/**
 * 测试自己解析仓库根：被测模块的 `REPO_ROOT` 走 `import.meta.dirname`，
 * 那个值在**vitest 的转换管线**下与 Node 直跑时不一致（生产路径是 Node 直跑 bin，
 * 不受影响）。测试一律显式传 `cwd`，不依赖任何模块级常量。
 */
function findRoot(start: string): string {
  let dir = path.resolve(start)
  for (;;) {
    if (path.basename(dir) === 'walnut-admin' && path.basename(path.dirname(dir)) === 'walnut-admin')
      return dir
    const up = path.dirname(dir)
    if (up === dir)
      throw new Error(`从 ${start} 向上找不到仓库根`)
    dir = up
  }
}
const ROOT = findRoot(process.cwd())
const read = (rel: string) => readTurboJson(path.join(ROOT, rel))
const dry = loadTurboDry(ROOT)

/**
 * ⚠️ **三个用例的前提：`apps/admin/env-local/` 存在**（= 那台机器解过密）。
 *
 * 这道门禁有三条不变量读的是**解密后的 env**（`VITE_BUILD_OUT_DIR` → 产物目录；`env-local/**`
 * 是否在 inputs 里）；`env-local/` 被 gitignore，**干净检出里根本没有** ⇒ 门禁按"不适用"跳过。
 *
 * 2026-09-23 实测到代价：这些用例只在有 env-local 的机器上通过，**CI 上一条不变量都不跑**
 * 于是三条断言全红（而它的发现是：这段测试此前从没在 CI 上跑过 —— `turbo run test --affected`
 * 只在改了 `packages/tooling/scripts` 的推送里才选中它）。
 * 处理方式是**把前提写出来**：有 env-local 时查正面，没有时另有一条用例查"它确实安静地跳过了"——
 * 两种情形都有断言，而不是让它静默 skip。
 *
 * **判据放模块级**：它在两个 describe 里都要用（跨块引用会直接 `ReferenceError`，实测踩到）。
 */
const hasEnvLocal = existsSync(path.join(ROOT, 'apps/admin/env-local'))

describe('readTurboJson', () => {
  it('按 JSONC 读根 turbo.json（里面有注释，JSON.parse 会炸）', () => {
    const cfg = read('turbo.json') as { tasks: Record<string, { dependsOn?: string[] }> }
    expect(Object.keys(cfg.tasks)).toContain('transit')
    expect(cfg.tasks['types:check'].dependsOn).toContain('transit')
  })

  it('包级 turbo.json 也能读', () => {
    const cfg = read('apps/docs/turbo.json') as { extends: string[] }
    expect(cfg.extends).toEqual(['//'])
  })
})

describe('globMatchesSomething', () => {
  it('命中真实文件', () => {
    expect(globMatchesSomething('package.json', ROOT)).toBe(true)
    expect(globMatchesSomething('packages/tooling/tsconfig/*.json', ROOT)).toBe(true)
    expect(globMatchesSomething('packages/tooling/vitest-config/*.ts', ROOT)).toBe(true)
  })

  it('匹配不到就返回 false —— 这是「globalDependencies 写错一个字」的判据', () => {
    expect(globMatchesSomething('packages/tooling/tsconfig/NOPE-*.json', ROOT)).toBe(false)
    expect(globMatchesSomething('apps/docs/does-not-exist.ts', ROOT)).toBe(false)
    expect(globMatchesSomething('packages/*/*/nowhere.ts', ROOT)).toBe(false)
  })
})

describe('declaredOutDirs', () => {
  it('从 env 文件里读出真实产物目录（去掉引号）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'walnut-outdir-'))
    const f = path.join(dir, '.env.stage')
    writeFileSync(f, 'FOO=1\nVITE_BUILD_OUT_DIR="dist-staging"\nBAR=2\n')
    expect(declaredOutDirs(f)).toEqual(['dist-staging'])
  })

  it('文件不存在时返回空数组（CI 没解密 env 属前置条件未满足，不算失败）', () => {
    expect(declaredOutDirs(path.join(tmpdir(), 'definitely-missing-env-file'))).toEqual([])
  })

  it('文件里没有这一项时也返回空数组', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'walnut-outdir-'))
    const f = path.join(dir, '.env.production')
    writeFileSync(f, 'VITE_PUBLIC_PATH="/"\n')
    expect(declaredOutDirs(f)).toEqual([])
  })
})

describe('nestOutDir —— server 侧产物目录的真源在 tsconfig', () => {
  const app = path.join(ROOT, 'apps/server')

  it('prod 落 dist、stage 落 dist-stage（两条流程不许共用目录）', () => {
    expect(nestOutDir(app, 'prod')).toBe('dist')
    expect(nestOutDir(app, 'stage')).toBe('dist-stage')
  })

  it('dev 落 dist（dev 不经 turbo 缓存，与 prod 共目录是有意的）', () => {
    expect(nestOutDir(app, 'dev')).toBe('dist')
  })

  it('配置不存在时返回 null（而不是编一个默认值出来）', () => {
    expect(nestOutDir(path.join(ROOT, 'apps/docs'), 'stage')).toBeNull()
  })
})

describe('collectFindings（对着真实仓库跑）', () => {
  it('本仓当前全部不变量都成立', () => {
    // 断言直接落在 «规则 id + 细节» 上：失败时能一眼看出是哪一条不变量、差在哪
    expect(collectFindings(dry, ROOT).map(f => `${f.rule} :: ${f.detail}`)).toEqual([])
  })

  it('解析到 15 个 workspace 包', () => {
    expect(packageDirs(dry, ROOT)).toHaveLength(15)
  })

  it.skipIf(!hasEnvLocal)('产物目录掉出 outputs 会被报出来（dist-staging 那个 bug 的守卫）', () => {
    const broken = structuredClone(dry)
    const t = broken.tasks.find(x => x.taskId === '@walnut/admin#build:stage')!
    t.resolvedTaskDefinition.outputs = ['dist/**', '.vitepress/dist/**']
    const hit = collectFindings(broken, ROOT).filter(f => f.rule === 'outputs-cover-artifacts')
    expect(hit).toHaveLength(1)
    expect(hit[0].detail).toContain('dist-staging')
  })

  it.skipIf(!hasEnvLocal)('env-local 掉出 inputs 会被报出来', () => {
    const broken = structuredClone(dry)
    for (const t of broken.tasks) {
      if (t.task === 'build' && t.resolvedTaskDefinition.inputs)
        t.resolvedTaskDefinition.inputs = t.resolvedTaskDefinition.inputs.filter(i => i !== 'env-local/**')
    }
    const hit = collectFindings(broken, ROOT).filter(f => f.rule === 'env-local-in-inputs')
    expect(hit.length).toBeGreaterThan(0)
    expect(hit[0].detail).toContain('env-local/**')
  })

  // 反面：干净检出（CI）里那三条不变量**跳过**，而不是误报 —— 这条断言在两种环境下都跑
  it('env-local 不存在时，读 env 的那三条不变量安静跳过（不是误报）', () => {
    const rules = ['env-local-in-inputs', 'outputs-cover-artifacts']
    const fired = collectFindings(dry, ROOT).filter(f => rules.includes(f.rule))
    if (hasEnvLocal)
      expect(fired, '有 env-local 时这面本来就该是干净的').toEqual([])
    else
      expect(fired, '没有 env-local ⇒ 前置条件不满足，门禁不该报').toEqual([])
  })

  it('docs#build 的输入里没有 .md 会被报出来', () => {
    const broken = structuredClone(dry)
    const t = broken.tasks.find(x => x.taskId === '@walnut/docs#build')!
    t.inputs = Object.fromEntries(Object.entries(t.inputs ?? {}).filter(([k]) => !k.endsWith('.md')))
    expect(collectFindings(broken, ROOT).map(f => f.rule)).toContain('docs-build-sees-markdown')
  })
})

describe('//#lint:root —— 根级文件也要能被缓存', () => {
  it('任务存在，且 inputs 逐字等于根脚本那三个 glob', () => {
    const task = (read('turbo.json') as { tasks: Record<string, { inputs?: string[] }> }).tasks['//#lint:root']
    expect(task.inputs).toEqual(['$TURBO_ROOT$/*.ts', '$TURBO_ROOT$/*.json', '$TURBO_ROOT$/*.yaml'])
  })

  it('它真的在 turbo 的图里（不是只写在配置里没人调）', () => {
    expect(dry.tasks.some(t => t.taskId === '//#lint:root')).toBe(true)
  })

  it('inputs 与脚本不一致时会被报出来（两个方向）', () => {
    // 直接打桩：把 package.json 的脚本读成多一个 glob 的样子做不到（断言读的是真文件），
    // 所以这条靠**负向注入实验**覆盖（见 turbo-cache-boundary.md 第六节）。
    // 这里只钉住「当前状态是自洽的」这一半。
    const f = collectFindings(dry, ROOT).filter(x => x.rule === 'lint-root-inputs')
    expect(f).toEqual([])
  })
})

describe('边界本身（哈希层的不变量回归）', () => {
  it('admin#types:check 经 transit 串到上游包 —— 断了这条边就回放假绿', () => {
    const t = dry.tasks.find(x => x.taskId === '@walnut/admin#types:check')!
    expect(t.resolvedTaskDefinition.dependsOn).toContain('transit')
    const transit = dry.tasks.find(x => x.taskId === '@walnut/admin#transit')!
    // 共享包（源码直消费）都该在上游：contract / types / utils / client / http / ui 至少各有一个
    expect((transit.dependencies ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('build:stage 的产物面覆盖 admin 的 staging 目录', () => {
    const t = dry.tasks.find(x => x.taskId === '@walnut/admin#build:stage')!
    expect(t.resolvedTaskDefinition.outputs).toContain('dist-staging/**')
  })

  it('docs#build 把 .md 算进输入 —— 它就是死链校验的输入', () => {
    const t = dry.tasks.find(x => x.taskId === '@walnut/docs#build')!
    expect(Object.keys(t.inputs ?? {}).filter(k => k.endsWith('.md')).length).toBeGreaterThan(100)
  })

  it('`.md` 仍被代码包的 build 排除（改 README 不该重建）', () => {
    const t = dry.tasks.find(x => x.taskId === '@walnut/admin#build')!
    expect(Object.keys(t.inputs ?? {}).filter(k => k.endsWith('.md'))).toEqual([])
  })

  // 同上前提：干净检出里 `env-local/` 不存在 ⇒ turbo 的 inputs 里也不会有它的文件
  it.skipIf(!hasEnvLocal)('env-local 在 build 的输入里（它被 gitignore，只能靠显式 glob 捞回来）', () => {
    for (const id of ['@walnut/admin#build', '@walnut/admin#build:stage']) {
      const t = dry.tasks.find(x => x.taskId === id)!
      expect(Object.keys(t.inputs ?? {}).filter(k => k.startsWith('env-local/')).length, id).toBeGreaterThan(0)
    }
  })

  it('全局依赖的关键成员仍在（globalCacheInputs 是它的真源）', () => {
    const files = Object.keys(dry.globalCacheInputs.files)
    expect(files).toContain('pnpm-workspace.yaml')
    expect(files).toContain('eslint.config.ts')
    expect(files).toContain('packages/tooling/tsconfig/base.json')
  })
})

/**
 * tags 的三条不变量（P1-17）。
 *
 * ⚠️ 这一段**没法靠改 `dry` 注入**：tags 是 `collectFindings` 从**盘上的 turbo.json** 读的，
 * 不在 dry 里。所以这里搭一个**临时夹具仓库**（`cwd` 指向 tmp），把 `dry` 里的 `directory`
 * 指到夹具包上 —— `packageDirs()` 就是靠 `directory` + `cwd` 还原包目录的。
 */
describe('tags —— 形态 / 平台一致 / 反向断言', () => {
  const ROOT_TURBO = {
    globalDependencies: [],
    boundaries: { tags: { shared: { dependencies: { deny: ['app'] } } } },
    tasks: {
      'transit': { dependsOn: ['^transit'] },
      'types:check': { dependsOn: ['transit'] },
      '//#lint:root': { inputs: ['$TURBO_ROOT$/*.ts'] },
    },
  }

  /** 造一个只含一个包的夹具仓库；`tags` 决定那个包的 turbo.json 长什么样 */
  function fixture(dir: string, tags: unknown): { cwd: string, dry: ReturnType<typeof fakeDry> } {
    const cwd = mkdtempSync(path.join(tmpdir(), 'walnut-tags-'))
    const pkgRoot = path.join(cwd, dir)
    mkdirSync(pkgRoot, { recursive: true })
    writeFileSync(path.join(cwd, 'turbo.json'), JSON.stringify(ROOT_TURBO, null, 2))
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { 'lint:root': 'eslint *.ts' } }))
    writeFileSync(path.join(pkgRoot, 'turbo.json'), JSON.stringify({ extends: ['//'], tags }, null, 2))
    return { cwd, dry: fakeDry(cwd, dir) }
  }

  function fakeDry(cwd: string, dir: string) {
    return {
      tasks: [{
        taskId: 'pkg#build',
        task: 'build',
        package: 'pkg',
        directory: path.join(cwd, dir),
        hash: 'x',
        resolvedTaskDefinition: { outputs: [], inputs: [] },
      }],
      packages: ['//', 'pkg'],
      globalCacheInputs: { files: {} },
    } as unknown as Parameters<typeof collectFindings>[0]
  }

  const rulesOf = (f: ReturnType<typeof fixture>) => collectFindings(f.dry, f.cwd).map(x => x.rule)

  it('合规的包里里外外都通过（夹具本身是绿的，才谈得上负对照）', () => {
    expect(rulesOf(fixture('packages/platform-any/a', ['shared', 'platform-any']))).toEqual([])
  })

  it('tags 写成大写/下划线 → 报 tag-shape（它匹配不上 boundaries 里任何一条规则）', () => {
    expect(rulesOf(fixture('packages/platform-any/a', ['shared', 'Platform_Web']))).toContain('tag-shape')
  })

  it('tags 有重复 → 报 tag-shape', () => {
    expect(rulesOf(fixture('packages/platform-any/a', ['shared', 'shared']))).toContain('tag-shape')
  })

  it('platform-any 目录下的包漏了 platform-any → 报', () => {
    expect(rulesOf(fixture('packages/platform-any/a', ['shared']))).toContain('platform-tag-matches-dir')
  })

  it('platform-any 目录下的包声明了 platform-web → 报（规则会套到错的一侧）', () => {
    expect(rulesOf(fixture('packages/platform-any/a', ['shared', 'platform-any', 'platform-web']))).toContain('platform-tag-matches-dir')
  })

  it('boundaries.tags 里有一条没有任何包声明它 → 报 boundary-rule-has-subject（恒关的规则 = 没有规则）', () => {
    const f = fixture('packages/platform-any/a', ['platform-any']) // 没有 `shared`
    expect(rulesOf(f)).toContain('boundary-rule-has-subject')
  })

  it('apps/* 不参与平台 tag 一致性检查（目录名与平台 tag 没有对应关系）', () => {
    expect(rulesOf(fixture('apps/docs', ['shared', 'app', 'docs']))).toEqual([])
  })
})

describe('跨平台：这一段门禁必须能在 CI 的 Linux runner 上跑', () => {
  /**
   * ⚠️ **必须先剥注释再断言** —— 这是参考仓安全评审里明确记过的一条教训：
   * 「子串匹配的断言可以被一行注释满足」。第一版这里直接扫源码，结果**被我自己写的
   * 那条「以前是 `execFileSync('cmd', …)`」的说明注释当场判红**（注释里当然有那个子串）。
   * 断言必须落在**代码位置**上，而不是文本里有没有出现过某个词。
   */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
      .replace(/(^|\s)\/\/.*$/gm, '$1') // 行注释（`://` 不会被吃掉）
  }
  const code = stripComments(readFileSync(path.join(ROOT, 'packages/tooling/scripts/src/ci/check-turbo-cache.ts'), 'utf8'))

  // 2026-09-23 读出来的真 bug：loadTurboDry 原本是 `execFileSync('cmd', ['/c', '… 2>nul'])`，
  // 那是**只在 Windows 上成立**的写法 —— CI 的 runner 是 ubuntu-latest，那里没有 `cmd`，
  // 会直接 ENOENT ⇒ 整段门禁在 CI 上从来没成立过（当时这些提交还没推过，所以没红过）。
  it('剥掉注释后的代码里不许再出现 cmd.exe / 2>nul', () => {
    expect(code, '又退回 Windows-only 了').not.toMatch(/execFileSync\(\s*'cmd'/)
    expect(code).not.toContain('2>nul')
  })

  it('改用 getPnpmBin()（本仓唯一被认可起 pnpm 的方式）', () => {
    expect(code).toContain('getPnpmBin()')
  })

  it('剥注释这一步本身是对的（否则上面两条可能是空转）', () => {
    const raw = readFileSync(path.join(ROOT, 'packages/tooling/scripts/src/ci/check-turbo-cache.ts'), 'utf8')
    expect(raw, '说明注释里应当提到那个旧写法').toContain('2>nul')
    expect(code, '剥完就该没有了').not.toContain('2>nul')
  })
})
