/**
 * 文档代码块校验的**纯逻辑**用例。
 *
 * 这个门禁的全部价值在于「零误报」—— 它是在实测「必须编译」在本仓语料上会 100% 误报之后
 * **收窄**成语法解析的（见 check-doc-ts.ts 顶部）。所以用例的重点是两条边界：
 *   ① 真实会发生的两类问题必须抓到（`ts` 块里装 JSON、块被写坏）；
 *   ② 合法写法与有意豁免一个都不许误报。
 */

import type { DocBlock } from '../check-doc-ts.ts'
import { describe, expect, it } from 'vitest'
import {
  collectFindings,
  fencedBlocks,
  findingsOfBlock,
  PSEUDO_MARKER,
  tsBlocksOf,
} from '../check-doc-ts.ts'

function block(code: string, lang = 'ts', line = 1): DocBlock {
  return { file: 'apps/docs/src/x.md', line, lang, code }
}

describe('fencedBlocks —— 抽围栏块', () => {
  it('抽出块内容与语言，并记下块内第一行的行号（1-based）', () => {
    const md = ['# 标题', '', '```ts', 'const a = 1', '```', ''].join('\n')
    expect(fencedBlocks('x.md', md)).toEqual([
      { file: 'x.md', line: 4, lang: 'ts', code: 'const a = 1' },
    ])
  })

  it('多种语言都抽出来（过滤交给 tsBlocksOf）', () => {
    const md = ['```bash', 'ls', '```', '', '```jsonc', '{ "a": 1 }', '```'].join('\n')
    expect(fencedBlocks('x.md', md).map(b => b.lang)).toEqual(['bash', 'jsonc'])
  })

  it('带 meta 的围栏（```ts{1,3}）会被抽出来，但语言标注是 `ts{1,3}` ⇒ 由 tsBlocksOf 过滤掉', () => {
    const md = ['```ts{1,3}', 'const a = 1', '```'].join('\n')
    const blocks = fencedBlocks('x.md', md)
    expect(blocks.map(b => b.lang)).toEqual(['ts{1,3}'])
    // 关键：**不检查**它。宁可漏报，也不去猜 meta 的语法。
    expect(tsBlocksOf(blocks)).toEqual([])
  })

  it('未闭合的围栏不产出块（不把文件尾当代码）', () => {
    const md = ['```ts', 'const a = 1'].join('\n')
    expect(fencedBlocks('x.md', md)).toEqual([])
  })

  it('缩进的围栏不算（那是列表里的代码块，本仓约定顶格写）', () => {
    const md = ['  ```ts', '  const a = 1', '  ```'].join('\n')
    expect(fencedBlocks('x.md', md)).toEqual([])
  })
})

describe('tsBlocksOf —— 只留 ts / tsx，并剔掉伪代码标记', () => {
  it('ts / tsx / typescript 都留，其它语言与无语言都不留', () => {
    const blocks: DocBlock[] = [
      block('const a = 1', 'ts'),
      block('const b = 1', 'tsx'),
      block('const c = 1', 'typescript'),
      block('const d = 1', 'js'),
      block('const e = 1', ''),
      block('# 标题', 'md'),
    ]
    expect(tsBlocksOf(blocks).map(b => b.lang)).toEqual(['ts', 'tsx', 'typescript'])
  })

  it(`第一行是 \`${PSEUDO_MARKER}\` 的块被豁免（有意的伪代码）`, () => {
    const blocks = [block(`${PSEUDO_MARKER}\nconst x = {...}`, 'ts'), block('const ok = 1', 'ts')]
    expect(tsBlocksOf(blocks)).toHaveLength(1)
    expect(tsBlocksOf(blocks)[0]?.code).toBe('const ok = 1')
  })

  it('标记必须**独立成行**：写在别处的同名注释不豁免', () => {
    const blocks = [block(`const a = 1 // ${PSEUDO_MARKER}`, 'ts')]
    expect(tsBlocksOf(blocks)).toHaveLength(1)
  })
})

describe('findingsOfBlock —— 绿路径不许误报', () => {
  const fine = [
    ['合法语句', 'const a: number = 1'],
    ['import', 'import type { Fn } from \'@walnut/types\''],
    ['接口', 'export interface IProps { a: string }'],
    ['片段：顶层 await 之外的表达式', 'defineStore(\'x\', { /* … */ })'],
    ['对象字面量作为实参', 'defineStore(StoreKeys.X, { /* … */ })'],
    ['泛型声明', 'type Box<T> = { value: T }'],
    ['装饰器', '@Injectable()\nclass A {}'],
    ['类型别名（原先是裸片段的那种写法）', 'type Permissions = string[]'],
    ['tsx', 'const el = <div class="a" />'],
  ] as const
  for (const [name, code] of fine) {
    it(`${name}：${JSON.stringify(code.slice(0, 44))}`, () => {
      const lang = name === 'tsx' ? 'tsx' : 'ts'
      expect(findingsOfBlock(block(code, lang))).toEqual([])
    })
  }
})

describe('findingsOfBlock —— JSON 装进 ts 块（本仓真实发生过 4 次）', () => {
  it('带注释的 JSONC 片段 → 报 json-in-ts 并给出改法', () => {
    const code = [
      '"packages/platform-any/contract": {',
      '  entry: ["src/index.ts"],  // barrel export → 追踪所有子模块',
      '},',
    ].join('\n')
    const got = findingsOfBlock(block(code))
    expect(got).toHaveLength(1)
    expect(got[0]?.kind).toBe('json-in-ts')
    expect(got[0]?.message).toContain('jsonc')
  })

  it('纯 JSON 也报（`{"a":1}` 在 ts 里同样不该出现）', () => {
    const got = findingsOfBlock(block('{ "a": 1 }'))
    expect(got[0]?.kind).toBe('json-in-ts')
  })

  it('真的 TS 语法错误**不会**被误判成 JSON', () => {
    const got = findingsOfBlock(block('const a = (1'))
    expect(got[0]?.kind).toBe('syntax')
  })
})

describe('findingsOfBlock —— 写坏了要定位到行', () => {
  it('报第一条诊断，并把块内相对行号换算成文件行号', () => {
    const got = findingsOfBlock(block('const a = 1\nconst b = (2', 'ts', 40))
    expect(got).toHaveLength(1)
    expect(got[0]?.kind).toBe('syntax')
    expect(got[0]?.line).toBe(41)
    expect(got[0]?.file).toBe('apps/docs/src/x.md')
  })

  it('省略占位 `{...}` 会被抓（这正是当初那处 ADR 片段的问题）', () => {
    const got = findingsOfBlock(block('const a = defineStore(Keys.X, {...})'))
    expect(got).toHaveLength(1)
    expect(got[0]?.kind).toBe('syntax')
  })

  it('截断（字符串没闭合）会被抓', () => {
    expect(findingsOfBlock(block('const a = "unterminated'))).toHaveLength(1)
  })
})

describe('collectFindings —— 汇总', () => {
  it('把给定文件里的所有 ts 块汇总成 findings', () => {
    const files = ['apps/docs/src/a.md']
    const texts: Record<string, string> = {
      'apps/docs/src/a.md': ['```ts', 'const ok = 1', '```', '', '```ts', '{ "a": 1 }', '```'].join('\n'),
    }
    const got = collectFindings(files, f => texts[f] ?? '')
    expect(got).toHaveLength(1)
    expect(got[0]?.file).toBe('apps/docs/src/a.md')
    expect(got[0]?.kind).toBe('json-in-ts')
  })

  it('扫描面的收窄是 `docFiles()` 的职责，`collectFindings` 只认它拿到的清单', () => {
    // 这条用例是**故意**的：把范围判断留在 docFiles() 里，collectFindings 才能是纯函数、好测。
    // 仓库根 AGENTS.md 不在文档站里，因此不会被 docFiles() 选中 —— 但若有人直接喂它，就会检查。
    const texts: Record<string, string> = {
      'AGENTS.md': ['```ts', 'const broken = (', '```'].join('\n'),
    }
    expect(collectFindings(['AGENTS.md'], f => texts[f] ?? '')).toHaveLength(1)
    expect(collectFindings([], () => '')).toEqual([])
  })
})
