/**
 * 文档引用校验的**纯逻辑**用例。
 *
 * 为什么重点测「提取」与「不误报」而不是「能报错」：这个门禁的价值全在**信噪比**上 ——
 * 一旦它开始报合法引用，人就会习惯性无视它，等于没做。所以每条提取规则都配了反例
 * （不该被当成引用的东西）。
 */

import { describe, expect, it } from 'vitest'
import {
  aliasResolves,
  ALLOWED_MISSING_PACKAGES,
  ALLOWED_MISSING_PATHS,
  collectFindings,
  extractAliasRefs,
  extractLinkTargets,
  extractPackageRefs,
  extractPathRefs,
  linkResolves,
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

describe('extractLinkTargets —— 只认显式相对（./ 与 ../）', () => {
  it('抽出相对链接与引用式定义', () => {
    const got = extractLinkTargets('见 [a](./x.md) 与 [b](../y/z.ts)\n\n[c]: ./w.md\n')
    expect(got.sort()).toEqual(['../y/z.ts', './w.md', './x.md'])
  })

  it('跳过外链 / 纯锚点 / 站点绝对路径 —— 站点绝对路径是 VitePress 的语义', () => {
    expect(extractLinkTargets('[a](https://x/y) [b](#sec) [c](/content/monorepo/index) [d](mailto:a@b.c)'))
      .toEqual([])
  })

  it('剥掉锚点与 title', () => {
    expect(extractLinkTargets('[a](./x.md#L18) [b](./y.md "标题")')).toEqual(['./x.md', './y.md'])
  })

  it('跳过代码块内的内容', () => {
    expect(extractLinkTargets('```\n[a](./nope.md)\n```')).toEqual([])
  })
})

describe('linkResolves —— 对齐 VitePress 的三种解析', () => {
  const onlyIndex = (p: string) => p === 'docs/a/index.md'
  const onlyBare = (p: string) => p === 'docs/b.ts'

  it('原样命中', () => {
    expect(linkResolves('./b.ts', 'docs/page.md', onlyBare)).toBe(true)
  })

  it('补 .md 命中（本仓 174 条相对链接里有 15 条不带后缀）', () => {
    expect(linkResolves('./a', 'docs/page.md', (p: string) => p === 'docs/a.md')).toBe(true)
  })

  it('当目录找 index.md 命中', () => {
    expect(linkResolves('./a', 'docs/page.md', onlyIndex)).toBe(true)
  })

  it('三种都不命中才算失效', () => {
    expect(linkResolves('./nope', 'docs/page.md', () => false)).toBe(false)
  })
})

describe('链接检查的覆盖边界（与 VitePress 零重叠）', () => {
  // 同一份正文，两个位置：文档站内 vs 文档站外
  const text = '# t\n\n[a](./gone.md)\n\n[b](./gone.yaml)\n'
  const opts = (file: string) => ({
    docs: [file],
    realPackages: new Set(['@walnut/x']),
    fsExists: () => false,
    readText: () => text,
  })

  it('文档站里的 .md 链接交给 VitePress（本门禁不报，避免与它的白名单重复）', () => {
    const found = collectFindings(opts('apps/docs/src/zh-CN/content/x.md'))
    expect(found.map(f => f.ref)).toEqual(['./gone.yaml'])
  })

  it('文档站里**非 .md** 的链接照查 —— VitePress 实测不查这类', () => {
    const found = collectFindings(opts('apps/docs/src/zh-CN/content/x.md'))
    expect(found.some(f => f.kind === 'link' && f.ref === './gone.yaml')).toBe(true)
  })

  it('文档站**之外**的 .md 链接照查 —— 没有任何其它工具管它', () => {
    const found = collectFindings(opts('apps/server/AGENTS.md'))
    expect(found.filter(f => f.kind === 'link').map(f => f.ref).sort()).toEqual(['./gone.md', './gone.yaml'])
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

describe('extractAliasRefs —— 反引号里的 TS 别名', () => {
  it('抽出 `@/…` 与 `@walnut-server/…`', () => {
    expect(extractAliasRefs('用 `@/decorators/field` 与 `@walnut-server/db`'))
      .toEqual(['@/decorators/field', '@walnut-server/db'])
  })

  it('代码块里的不算（那是示例，不是引用）', () => {
    expect(extractAliasRefs('```ts\nimport x from \'@/nope\'\n```')).toEqual([])
  })

  it('通配符不算（`@/modules/*` 这种没法判存在）', () => {
    expect(extractAliasRefs('`@/modules/*`')).toEqual([])
  })
})

describe('aliasResolves —— 只对 .claude/skills/** 生效', () => {
  const onlyOne = (p: string) => p === 'apps/server/libs/db/src'

  it('skill 目录之外一律返回 true（`@/` 的基址随 app 而变，普通文档里无从判断）', () => {
    expect(aliasResolves('@/whatever/does-not-exist', 'apps/server/AGENTS.md', () => false)).toBe(true)
    expect(aliasResolves('@/whatever/does-not-exist', 'apps/docs/src/x.md', () => false)).toBe(true)
  })

  it('`be-*` → 后端基址（apps/api/src）', () => {
    expect(aliasResolves('@/decorators/field', '.claude/skills/be-gen-module/SKILL.md', p => p === 'apps/server/apps/api/src/decorators/field')).toBe(true)
    expect(aliasResolves('@/decorators/field', '.claude/skills/be-gen-module/SKILL.md', () => false)).toBe(false)
  })

  it('`fe-*` → 前端基址（apps/admin/src）', () => {
    expect(aliasResolves('@/hooks/core/useProps', '.claude/skills/fe-walnut-component/SKILL.md', p => p === 'apps/admin/src/hooks/core/useProps.ts')).toBe(true)
  })

  it('`@walnut-server/<lib>/<rest>` 按 tsconfig paths 映射到 libs/<lib>/src/<rest>', () => {
    expect(aliasResolves('@walnut-server/db', '.claude/skills/be-x/SKILL.md', onlyOne)).toBe(true)
    expect(aliasResolves('@walnut-server/utils/dto', '.claude/skills/be-x/SKILL.md', p => p === 'apps/server/libs/utils/src/dto.ts')).toBe(true)
  })
})

describe('collectFindings —— 别名失效要报出来', () => {
  it('skill 里的坏别名 → kind = alias', () => {
    const got = collectFindings({
      docs: ['.claude/skills/be-gen-module/SKILL.md'],
      realPackages: new Set(['@walnut/db']),
      fsExists: () => false,
      readText: () => '字段装饰器来自 `@/decorators/field`',
    })
    expect(got.some(f => f.kind === 'alias' && f.ref === '@/decorators/field')).toBe(true)
  })

  it('非 skill 文档里的同名写法**不报**（避免误报）', () => {
    const got = collectFindings({
      docs: ['apps/server/AGENTS.md'],
      realPackages: new Set(['@walnut/db']),
      fsExists: () => false,
      readText: () => '字段装饰器来自 `@/decorators/field`',
    })
    expect(got.filter(f => f.kind === 'alias')).toEqual([])
  })
})
