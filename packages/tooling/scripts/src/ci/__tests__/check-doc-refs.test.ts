/**
 * 文档引用校验的**纯逻辑**用例。
 *
 * 为什么重点测「提取」与「不误报」而不是「能报错」：这个门禁的价值全在**信噪比**上 ——
 * 一旦它开始报合法引用，人就会习惯性无视它，等于没做。所以每条提取规则都配了反例
 * （不该被当成引用的东西）。
 */

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MISSING_PACKAGES,
  ALLOWED_MISSING_PATHS,
  collectFindings,
  extractPackageRefs,
  extractPathRefs,
  pathResolves,
  workspacePackageNames,
} from '../check-doc-refs.ts'

describe('extractPackageRefs —— 只认 @walnut/<段>', () => {
  it('抽出包名并去重', () => {
    expect(extractPackageRefs('见 `@walnut/contract` 与 @walnut/utils，还有 @walnut/contract'))
      .toEqual(['@walnut/contract', '@walnut/utils'])
  })

  it('不把 @walnut-server/*（后端内部 lib 命名空间）当成包', () => {
    expect(extractPackageRefs('import x from \'@walnut-server/const\'')).toEqual([])
  })

  it('不把裸 scope 或 scoped 目录写法当成包', () => {
    expect(extractPackageRefs('packages/platform-any/contract 与 @walnut/')).toEqual([])
  })
})

describe('extractPathRefs —— 只认 markdown 里以顶层目录开头的路径', () => {
  it('抽出带扩展名的与目录形态的', () => {
    const got = extractPathRefs('见 `packages/tooling/release/src/release/steps.ts` 与 `apps/server/env-local/`')
    expect(got).toContain('packages/tooling/release/src/release/steps.ts')
    expect(got).toContain('apps/server/env-local/')
  })

  it('跳过通配 / 占位 / 省略号 / URL / 家目录', () => {
    expect(extractPathRefs('`packages/*/*/node_modules` `apps/admin/.../AI/docs/` `https://x/packages/a.ts` `~/a/b.ts`'))
      .toEqual([])
  })

  it('跳过不以顶层目录开头的半截片段（最容易误报的一类）', () => {
    expect(extractPathRefs('`src/index.ts` `./relative/thing.md` `nested/deep/file.md`')).toEqual([])
  })

  it('但 `scripts/build-barrel.ts` 这种**要**抽出来 —— 它与顶层目录同名，正是要抓的死引用', () => {
    // 2026-09-23 实测：这条在 typescript.md / tsconfig README 里出现过，实际路径在
    // packages/platform-any/contract/scripts/ 下 —— 属于「看起来对、其实不存在」的典型
    expect(extractPathRefs('裸 `scripts/build-barrel.ts`')).toEqual(['scripts/build-barrel.ts'])
  })

  it('跳过代码块内的内容（那是示例，不是引用）', () => {
    expect(extractPathRefs('```\napps/whatever/does-not-exist.ts\n```')).toEqual([])
  })
})

describe('pathResolves —— 语境解析（仓库根 / 文档所在目录 / apps-server）', () => {
  // 只认为 apps/server/env-local 存在；断言用的是**仓库相对正斜杠**路径（见 pathResolves 的注释）
  const onlyServerEnv = (p: string) => p === 'apps/server/env-local'

  it('相对仓库根命中', () => {
    expect(pathResolves('apps/server/env-local', 'README.md', onlyServerEnv)).toBe(true)
  })

  it('相对文档自身目录命中', () => {
    // 文档在 apps/server/libs/config/ 下：上两级才到 apps/server/env-local
    expect(pathResolves('../../env-local', 'apps/server/libs/config/README.md', onlyServerEnv)).toBe(true)
  })

  it('相对 apps/server 命中（`env-local/` 这类写法的来源）', () => {
    expect(pathResolves('env-local/', 'apps/docs/src/zh-CN/content/monorepo/env-management.md', (p: string) => p === 'apps/server/env-local/')).toBe(true)
  })

  it('三处都不命中才算不存在', () => {
    expect(pathResolves('apps/nope/nope.ts', 'README.md', () => false)).toBe(false)
  })
})

describe('真实仓库上跑一遍（防豁免清单腐化）', () => {
  it('当前仓库没有任何未豁免的失效引用', () => {
    expect(collectFindings()).toEqual([])
  })

  it('豁免清单里**没有已经能解析**的条目（留着会让清单越积越长）', () => {
    // 包名豁免：@walnut/i18n 与 @walnut/security 是规划中，其余是历史名 —— 都不该真实存在
    const real = workspacePackageNames()
    expect(real.size).toBeGreaterThan(0)
    const stale = Object.keys(ALLOWED_MISSING_PACKAGES).filter(name => real.has(name))
    expect(stale, `这些包已经存在了，请从 ALLOWED_MISSING_PACKAGES 删掉：${stale.join(', ')}`).toEqual([])
  })

  it('豁免路径的清单里都写了理由', () => {
    for (const [key, reason] of Object.entries(ALLOWED_MISSING_PATHS))
      expect(reason.length, `${key} 的豁免理由太短，等于没写`).toBeGreaterThan(8)
  })
})
