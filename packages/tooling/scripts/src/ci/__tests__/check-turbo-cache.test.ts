import { mkdtempSync, writeFileSync } from 'node:fs'
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
  it('本仓当前 6 条不变量全部成立', () => {
    // 断言直接落在 «规则 id + 细节» 上：失败时能一眼看出是哪一条不变量、差在哪
    expect(collectFindings(dry, ROOT).map(f => `${f.rule} :: ${f.detail}`)).toEqual([])
  })

  it('解析到 15 个 workspace 包', () => {
    expect(packageDirs(dry, ROOT)).toHaveLength(15)
  })

  it('产物目录掉出 outputs 会被报出来（dist-staging 那个 bug 的守卫）', () => {
    const broken = structuredClone(dry)
    const t = broken.tasks.find(x => x.taskId === '@walnut/admin#build:stage')!
    t.resolvedTaskDefinition.outputs = ['dist/**', '.vitepress/dist/**']
    const hit = collectFindings(broken, ROOT).filter(f => f.rule === 'outputs-cover-artifacts')
    expect(hit).toHaveLength(1)
    expect(hit[0].detail).toContain('dist-staging')
  })

  it('env-local 掉出 inputs 会被报出来', () => {
    const broken = structuredClone(dry)
    for (const t of broken.tasks) {
      if (t.task === 'build' && t.resolvedTaskDefinition.inputs)
        t.resolvedTaskDefinition.inputs = t.resolvedTaskDefinition.inputs.filter(i => i !== 'env-local/**')
    }
    const hit = collectFindings(broken, ROOT).filter(f => f.rule === 'env-local-in-inputs')
    expect(hit.length).toBeGreaterThan(0)
    expect(hit[0].detail).toContain('env-local/**')
  })

  it('docs#build 的输入里没有 .md 会被报出来', () => {
    const broken = structuredClone(dry)
    const t = broken.tasks.find(x => x.taskId === '@walnut/docs#build')!
    t.inputs = Object.fromEntries(Object.entries(t.inputs ?? {}).filter(([k]) => !k.endsWith('.md')))
    expect(collectFindings(broken, ROOT).map(f => f.rule)).toContain('docs-build-sees-markdown')
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

  it('env-local 在 build 的输入里（它被 gitignore，只能靠显式 glob 捞回来）', () => {
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
