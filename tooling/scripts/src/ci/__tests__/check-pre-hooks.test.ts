import { describe, expect, it } from 'vitest'

import { collectFindings, execTokens, findingsForPackage } from '../check-pre-hooks.ts'
import { PRE_HOOK_CONSUMERS } from '../pre-hook-consumers.ts'

/**
 * 这条门禁的判据是「**包内有 `build/generate/` ⇒ 它跑消费者的脚本都要有 `pre<script>`**」。
 * 消费者名单是数据（同目录 `pre-hook-consumers.ts`），门禁逻辑只读它 ——
 * 所以这里除了纯函数用例，还专门钉住「新增消费者只改数据」这条性质。
 * 用例全部走纯函数 + 注入的 `fileExists`，不依赖真仓的工作区状态。
 */
const adminLike = {
  label: '@walnut/admin',
  hasGenerators: true,
  fileExists: () => true,
}

describe('脚本前置钩子：有生成物的包，跑消费者的脚本必须接生成', () => {
  it('回归（2026-09-24 那次事故）：`build` 缺 `prebuild` ⇒ 报 consumer-script-needs-pre-generate', () => {
    const findings = findingsForPackage({ ...adminLike, scripts: { build: 'vite build' } })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('consumer-script-needs-pre-generate')
    expect(findings[0]?.detail).toContain('prebuild')
  })

  it('四个入口都接了 ⇒ 干净（dev / build / build:stage / types:check）', () => {
    const findings = findingsForPackage({
      ...adminLike,
      scripts: {
        predev: 'node build/generate/index.ts',
        dev: 'vite',
        prebuild: 'node build/generate/index.ts',
        build: 'vite build',
        'prebuild:stage': 'node build/generate/index.ts',
        'build:stage': 'vite build --mode stage',
        'pretypes:check': 'node build/generate/index.ts',
        'types:check': 'vue-tsc --noEmit',
      },
    })
    expect(findings).toEqual([])
  })

  it('`vue-tsc` 同样要钩子（它也是最早就读生成物的那个）', () => {
    const findings = findingsForPackage({
      ...adminLike,
      scripts: { 'types:check': 'vue-tsc --noEmit' },
    })
    expect(findings[0]?.rule).toBe('consumer-script-needs-pre-generate')
    expect(findings[0]?.detail).toContain('pretypes:check')
  })

  it('`vite preview` 不要求钩子（它伺服的是**已构建**的产物）', () => {
    const findings = findingsForPackage({
      ...adminLike,
      scripts: {
        preview: 'vite preview --mode production',
        'preview:stage': 'vite preview --mode stage',
      },
    })
    expect(findings).toEqual([])
  })

  it('**没有生成物的包一律不管** —— 否则第一天就在 `@walnut/contract` 上误报', () => {
    const findings = findingsForPackage({
      label: '@walnut/contract',
      hasGenerators: false,
      fileExists: () => true,
      scripts: { build: 'vite build && node scripts/build-barrel.ts' },
    })
    expect(findings).toEqual([])
  })

  it('钩子指向不存在的文件 ⇒ 报 pre-hook-target-exists（改名后静默失效）', () => {
    const findings = findingsForPackage({
      ...adminLike,
      fileExists: (rel) => rel !== 'build/generate/gone.ts',
      scripts: { prebuild: 'node build/generate/gone.ts', build: 'vite build' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('pre-hook-target-exists')
    expect(findings[0]?.detail).toContain('gone.ts')
  })

  it('环境包装词不影响识别（cross-env / KEY=value）', () => {
    expect(execTokens('cross-env NODE_ENV=production vite build')).toEqual(['vite', 'build'])
    expect(execTokens('NODE_OPTIONS=--max-old-space-size=8192 vite build')).toEqual([
      'vite',
      'build',
    ])
    const findings = findingsForPackage({
      ...adminLike,
      scripts: { 'build:prod': 'cross-env NODE_ENV=production vite build' },
    })
    expect(findings[0]?.rule).toBe('consumer-script-needs-pre-generate')
  })

  it('别的命令不管（vitepress / nest / eslint / echo / 直接 node）', () => {
    const findings = findingsForPackage({
      ...adminLike,
      scripts: {
        build: 'vitepress build',
        dev: 'nest start api --watch',
        lint: 'eslint . --concurrency=auto',
        probe: 'echo hi',
        gen: 'node build/generate/index.ts',
      },
    })
    expect(findings).toEqual([])
  })
})

describe('数据驱动：新增消费者只改数据', () => {
  it('注入一个新消费者后，它自动被要求 pre 钩子', () => {
    const findings = findingsForPackage({ ...adminLike, scripts: { build: 'oxfmt build' } }, [
      { bin: 'oxfmt', why: '用例：证明名单来自数据而不是硬编码' },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('consumer-script-needs-pre-generate')
    expect(findings[0]?.detail).toContain('prebuild')
  })

  it('注入的消费者的例外子命令也来自数据（不是硬编码的 preview）', () => {
    const findings = findingsForPackage(
      { ...adminLike, scripts: { serve: 'oxfmt build --watch' } },
      [{ bin: 'oxfmt', exemptSubcommands: ['build'], why: '用例：例外子命令同样来自数据' }],
    )
    expect(findings).toEqual([])
  })

  it('真实名单里至少有 vite 与 vue-tsc（防「数据被清空却全绿」）', () => {
    // 空名单会让所有断言静默通过 —— 这是本仓最忌讳的失效形态
    expect(PRE_HOOK_CONSUMERS.map((c) => c.bin)).toEqual(
      expect.arrayContaining(['vite', 'vue-tsc']),
    )
    expect(findingsForPackage({ ...adminLike, scripts: { build: 'vite build' } })).toHaveLength(1)
    expect(
      findingsForPackage({ ...adminLike, scripts: { 'types:check': 'vue-tsc --noEmit' } }),
    ).toHaveLength(1)
  })

  it('每条消费者都写了 `why`（名单过期时靠它排查）', () => {
    for (const consumer of PRE_HOOK_CONSUMERS)
      expect(consumer.why.length, `${consumer.bin} 缺 why`).toBeGreaterThan(0)
  })
})

describe('真仓自检（正面控制）', () => {
  it('当前仓库不报任何东西 —— 包括 `@walnut/contract` 那条 `vite build`', () => {
    expect(collectFindings()).toEqual([])
  })
})
