/**
 * ADR 形态校验的**纯逻辑**用例。
 *
 * 为什么每条判据都配一个反例：这个门禁的价值全在「它拦下的都是真形态错误、放过的都是合法写法」。
 * 尤其 `## Alternatives considered` 的**位置**判据 —— ADR 0012 的 `## Consequences` 在正文中间
 * （Decision 4 之后还有 Decision 5/6/7），所以位置判据只要求「在第一个 `## Decision` 之后」，
 * 刻意不约束它与 Consequences 的先后。那条真实 ADR 就是这里的回归用例。
 */

import { describe, expect, it } from 'vitest'
import {
  ADR_DIR,
  ADR_STATUSES,
  collectFindings,
  dateOf,
  headingsOf,
  statusOf,
} from '../check-adr.ts'

const INDEX = `${ADR_DIR}/index.md`

/** 一篇形态完全合规的 ADR；各用例只改自己关心的那一处 */
function adr(options: {
  number?: string
  title?: string
  date?: string
  status?: string
  extra?: string
} = {}): string {
  const number = options.number ?? '0001'
  return [
    `# ADR-${number}: ${options.title ?? 'Something'}  `,
    '',
    `**Date:** ${options.date ?? '2026-01-01'}  `,
    `**Status:** ${options.status ?? 'Accepted'}`,
    '',
    '## Context',
    '',
    '背景。',
    '',
    '## Decision',
    '',
    '决定。',
    '',
    options.extra ?? '',
    '## Alternatives considered',
    '',
    '- **备选** —— 没选它的理由。',
    '',
    '## Consequences',
    '',
    '后果。',
    '',
  ].join('\n')
}

function indexText(rows: Array<{ number: string, target: string, status: string }>): string {
  return [
    '# 架构决策记录 (ADR)',
    '',
    '| ADR | 决策 | 状态 |',
    '|-----|------|------|',
    ...rows.map(r => `| [${r.number}](./${r.target}) | 某决策 | ${r.status} |`),
    '',
  ].join('\n')
}

/** 单篇 ADR 的最小输入；index 行的状态**默认跟着文件里的 Status 走**（否则会误报「两处不一致」） */
function one(text: string, options: { number?: string, file?: string, index?: string } = {}) {
  const number = options.number ?? '0001'
  const file = options.file ?? `${ADR_DIR}/${number}-something.md`
  const target = `${number}-something.md`
  const status = statusOf(text) ?? 'Accepted'
  const index = options.index ?? indexText([{ number, target, status }])
  return collectFindings({
    files: [file, INDEX],
    indexText: index,
    readText: f => (f === INDEX ? index : text),
  })
}

function problems(text: string): string[] {
  return one(text).map(f => f.problem)
}

describe('headingsOf —— 只看二级标题', () => {
  it('抽出 `## ` 且忽略 `### ` 与 `#### `', () => {
    // offset 是 `## ...` 里第一个 `#` 的下标（`# a\n` 占 0–3，所以 Context 在 4）
    expect(headingsOf('# a\n## Context\n### 子\n## Decision\n#### 更深')).toEqual([
      { title: 'Context', offset: 4 },
      { title: 'Decision', offset: 21 },
    ])
  })

  it('不看行内井号（`#notaheading` 不是标题）', () => {
    expect(headingsOf('#notaheading\n## Real')).toEqual([{ title: 'Real', offset: 13 }])
  })
})

describe('statusOf / dateOf', () => {
  it('取值去掉尾随空格（行尾双空格是 markdown 换行，历史文件里到处都是）', () => {
    expect(statusOf('**Status:** Accepted  \n')).toBe('Accepted')
    expect(dateOf('**Date:** 2026-07-28  \n')).toBe('2026-07-28')
  })

  it('没有该行时返回 null（而不是空串 —— 调用方靠 null 区分「缺行」与「空值」）', () => {
    expect(statusOf('## Context')).toBe(null)
    expect(dateOf('## Context')).toBe(null)
  })
})

describe('collectFindings —— 绿路径', () => {
  it('形态合规时零 findings', () => {
    expect(one(adr())).toEqual([])
  })

  it('多篇连续编号、index 逐行对齐时零 findings', () => {
    const files = [`${ADR_DIR}/0001-a.md`, `${ADR_DIR}/0002-b.md`, INDEX]
    const rows = [
      { number: '0001', target: '0001-a.md', status: 'Accepted' },
      { number: '0002', target: '0002-b.md', status: 'Rejected' },
    ]
    const texts: Record<string, string> = {
      [files[0]!]: adr({ number: '0001', title: 'A' }),
      [files[1]!]: adr({ number: '0002', title: 'B', status: 'Rejected' }),
      [INDEX]: indexText(rows),
    }
    expect(collectFindings({ files, indexText: texts[INDEX]!, readText: f => texts[f]! })).toEqual([])
  })

  it('`Decision 1` / `Decision 2` 这种带序号的 Decision 也算数', () => {
    const text = adr().replace('## Decision', '## Decision 1: 第一件事')
    expect(one(text)).toEqual([])
  })

  it('aDR 0012 那种「Consequences 夹在 Decision 中间」的真实形态不算错', () => {
    // 位置判据只要求 Alternatives 在**第一个** Decision 之后；这里 Consequences 提前出现
    const text = [
      '# ADR-0001: X',
      '',
      '**Date:** 2026-01-01',
      '**Status:** Accepted',
      '',
      '## Context',
      '## Decision 1',
      '## Consequences',
      '## Decision 2',
      '## Alternatives considered',
      '- **备选** —— 理由。',
      '## Related',
      '',
    ].join('\n')
    expect(problems(text)).toEqual([])
  })
})

describe('collectFindings —— 号段与标题', () => {
  it('文件名不是 NNNN-kebab 形态时报错', () => {
    const got = one(adr(), { file: `${ADR_DIR}/nope.md` })
    expect(got.some(f => f.problem.includes('NNNN-<kebab-slug>'))).toBe(true)
  })

  it('缺号时报「编号不连续」', () => {
    const files = [`${ADR_DIR}/0001-a.md`, `${ADR_DIR}/0003-c.md`, INDEX]
    const got = collectFindings({
      files,
      indexText: indexText([]),
      readText: f => (f === INDEX ? indexText([]) : adr({ number: f.includes('0003') ? '0003' : '0001' })),
    })
    expect(got.some(f => f.problem.includes('编号不连续'))).toBe(true)
  })

  it('标题编号与文件名不一致时报错', () => {
    const got = problems(adr({ title: 'X' }).replace('# ADR-0001:', '# ADR-0009:'))
    expect(got.some(p => p.includes('与文件名 0001 不一致'))).toBe(true)
  })

  it('标题形态不对时报错', () => {
    expect(problems(adr().replace(/^# ADR-0001:.*$/m, '# 某个 ADR')))
      .toContain('首部标题不是 `# ADR-NNNN: <title>` 形态')
  })
})

describe('collectFindings —— 状态枚举', () => {
  it('缺 Status 行时报错', () => {
    expect(problems(adr().replace(/^\*\*Status:\*\*.*$/m, '')))
      .toContain('缺 `**Status:**` 行')
  })

  it('`Implemented` 被拒 —— 它记的是「代码写完没有」，不是「决策算不算数」', () => {
    const got = problems(adr({ status: 'Implemented (Phase 4 completed 2026-07-29)' }))
    expect(got.some(p => p.includes('取值不在枚举内'))).toBe(true)
  })

  it('`In Progress` 被拒', () => {
    expect(problems(adr({ status: 'In Progress — Phase 1 + 2 完成' }))
      .some(p => p.includes('取值不在枚举内'))).toBe(true)
  })

  it('四个枚举值 + Superseded by 都放行', () => {
    for (const status of ADR_STATUSES)
      expect(problems(adr({ status })), status).toEqual([])

    // Superseded 需要目标存在：造两篇，0002 被 0001 取代
    const files = [`${ADR_DIR}/0001-a.md`, `${ADR_DIR}/0002-b.md`, INDEX]
    const rows = [
      { number: '0001', target: '0001-a.md', status: 'Accepted' },
      { number: '0002', target: '0002-b.md', status: 'Superseded by ADR-0001' },
    ]
    const texts: Record<string, string> = {
      [files[0]!]: adr({ number: '0001', title: 'A' }),
      [files[1]!]: adr({ number: '0002', title: 'B', status: 'Superseded by ADR-0001' }),
      [INDEX]: indexText(rows),
    }
    expect(collectFindings({ files, indexText: texts[INDEX]!, readText: f => texts[f]! })).toEqual([])
  })

  it('superseded 指向不存在的 ADR 时报错', () => {
    expect(problems(adr({ status: 'Superseded by ADR-0042' }))
      .some(p => p.includes('指向的 ADR 不存在'))).toBe(true)
  })

  it('superseded 的目标不是四位编号时报错', () => {
    expect(problems(adr({ status: 'Superseded by ADR-42' }))
      .some(p => p.includes('不是四位编号'))).toBe(true)
  })

  it('日期形态不对时报错', () => {
    expect(problems(adr({ date: '2026/01/01' })))
      .toContain('`**Date:**` 不是 YYYY-MM-DD 形态（现值 2026/01/01）')
  })
})

describe('collectFindings —— 四个必需小节', () => {
  it('缺 Context / Decision / Consequences 各自报一条', () => {
    expect(problems(adr().replace('## Context\n\n背景。\n\n', ''))).toContain('缺 `## Context` 小节')
    expect(problems(adr().replace('## Decision\n\n决定。\n\n', ''))).toContain('缺 `## Decision` 小节')
    // 模板末尾只有一个换行，所以这里按「从 Consequences 到文件结尾」整段删
    expect(problems(adr().replace(/## Consequences[\s\S]*$/, ''))).toContain('缺 `## Consequences` 小节')
  })

  it('缺 Alternatives 时报错', () => {
    expect(problems(adr().replace('## Alternatives considered\n\n- **备选** —— 没选它的理由。\n\n', '')))
      .toContain('缺 `## Alternatives considered` 小节')
  })

  it('alternatives 出现两次时报错（只允许一个家）', () => {
    const text = adr().replace('## Consequences', '## Alternatives considered\n\n- **又一个** —— 理由。\n\n## Consequences')
    expect(problems(text).some(p => p.includes('出现了 2 次'))).toBe(true)
  })

  it('alternatives 排在第一个 Decision 之前时报错', () => {
    const text = [
      '# ADR-0001: X',
      '',
      '**Date:** 2026-01-01',
      '**Status:** Accepted',
      '',
      '## Context',
      '## Alternatives considered',
      '- **备选** —— 理由。',
      '## Decision',
      '## Consequences',
      '',
    ].join('\n')
    expect(problems(text)).toContain('`## Alternatives considered` 排在第一个 `## Decision` 之前')
  })

  it('alternatives 里一条列表项都没有时报错（不允许空壳凑格式）', () => {
    const text = adr().replace('- **备选** —— 没选它的理由。', '本节待补。')
    expect(problems(text)).toContain('`## Alternatives considered` 里没有任何列表项（至少写一条）')
  })

  it('有序列表 / `*` 列表也算列表项', () => {
    expect(problems(adr().replace('- **备选** —— 没选它的理由。', '* **备选** —— 理由。'))).toEqual([])
  })
})

describe('collectFindings —— 与 index.md 双向对齐', () => {
  it('aDR 没登记进表格时报错', () => {
    const got = one(adr(), { index: indexText([]) })
    expect(got.some(f => f.file === INDEX && f.problem.includes('没有登记进表格'))).toBe(true)
  })

  it('表格里的编号没有对应文件时报错', () => {
    const got = one(adr(), {
      index: indexText([{ number: '0001', target: '0001-something.md', status: 'Accepted' }, { number: '0009', target: '0009-ghost.md', status: 'Accepted' }]),
    })
    expect(got.some(f => f.problem.includes('表格里的 0009 没有对应文件'))).toBe(true)
  })

  it('链接指向不存在的文件时报错', () => {
    const got = one(adr(), { index: indexText([{ number: '0001', target: '0001-typo.md', status: 'Accepted' }]) })
    expect(got.some(f => f.problem.includes('该文件不存在'))).toBe(true)
  })

  it('状态列与文件里的 Status 必须逐字一致', () => {
    const got = one(adr(), { index: indexText([{ number: '0001', target: '0001-something.md', status: '✅ 已实现' }]) })
    expect(got.some(f => f.problem.includes('两处必须逐字一致'))).toBe(true)
  })

  it('index 表格一行都解析不到时报错（而不是静默通过）', () => {
    const got = one(adr(), { index: '# 架构决策记录\n\n（表格没了）\n' })
    expect(got.some(f => f.problem.includes('一行都没解析到'))).toBe(true)
  })
})

describe('collectFindings —— 空扫描面', () => {
  it('一篇 ADR 都没有时拒绝当绿灯', () => {
    const got = collectFindings({ files: [INDEX], indexText: indexText([]), readText: () => '' })
    expect(got).toHaveLength(1)
    expect(got[0]?.problem).toContain('扫不到东西')
  })

  it('index.md 与 zod-evaluation.md 不作为 ADR 参与判据', () => {
    const files = [`${ADR_DIR}/0001-a.md`, `${ADR_DIR}/zod-evaluation.md`, INDEX]
    expect(collectFindings({
      files,
      indexText: indexText([{ number: '0001', target: '0001-a.md', status: 'Accepted' }]),
      readText: f => (f.endsWith('index.md') ? indexText([{ number: '0001', target: '0001-a.md', status: 'Accepted' }]) : adr()),
    })).toEqual([])
  })
})
