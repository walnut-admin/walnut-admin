/**
 * 续跑阶梯（plan.ts）—— 本套用例的价值在于把**每一条断点路径**钉住：
 * 发版是多步且不可逆的，任何一步失败或 Ctrl+C 之后重跑都必须从断点接上。
 *
 * 顺序上有一条不能动的性质：**「已 bump」排在「有待消费意图」之前**（见下方 ordering 用例）。
 */

import type { ReleaseFacts, ReleaseNoteInput, ReleaseStep } from '../plan.ts'
import { describe, expect, it } from 'vitest'
import { buildReleaseNotes, describeStep, extractChangelogSection, isBumped, planRelease, releaseNoteSource } from '../plan.ts'

/**
 * 默认事实：一个「刚发完 v1.0.0、没有待办」的干净仓库。
 * 每个用例只覆盖它关心的那几个字段 —— 阶梯的判据是顺序的，全量覆盖会看不出是哪一档命中。
 */
function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return {
    pendingIntents: 0,
    versionConsumed: false,
    releaseCommit: null,
    currentVersion: '1.0.0',
    branch: 'main',
    baseTag: 'v1.0.0',
    baseVersion: '1.0.0',
    localTagExists: false,
    remoteTagExists: false,
    remoteReleaseExists: false,
    releaseChecked: false,
    branchPushed: true,
    commitsSinceTag: 0,
    stateStep: null,
    bumpUncommitted: false,
    groupMisaligned: [],
    ...overrides,
  }
}

describe('isBumped —— 版本是否已离开上一个 tag 的基线', () => {
  it('没有基线 tag（首次发版）不算已 bump', () => {
    expect(isBumped({ currentVersion: '1.0.0', baseVersion: null })).toBe(false)
  })

  it('版本与基线相同 ⇒ 未 bump；不同 ⇒ 已 bump', () => {
    expect(isBumped({ currentVersion: '1.0.0', baseVersion: '1.0.0' })).toBe(false)
    expect(isBumped({ currentVersion: '1.1.0', baseVersion: '1.0.0' })).toBe(true)
    expect(isBumped({ currentVersion: '1.0.0', baseVersion: '1.1.0' })).toBe(true)
  })
})

describe('planRelease —— 阶梯的每一档', () => {
  it('① 已 bump 且还没提交 ⇒ confirm-summary', () => {
    const plan = planRelease(facts({ currentVersion: '1.1.0', bumpUncommitted: true }))
    expect(plan.step).toBe('confirm-summary')
    expect(plan.tag).toBe('v1.1.0')
    expect(plan.reason).toContain('还没提交')
    expect(plan.reason).toContain('v1.1.0')
    expect(plan.reason).toContain('v1.0.0')
  })

  it('① 已 bump 且已提交 ⇒ commit-tag-push', () => {
    const plan = planRelease(facts({ currentVersion: '1.1.0', bumpUncommitted: false }))
    expect(plan.step).toBe('commit-tag-push')
    expect(plan.tag).toBe('v1.1.0')
    expect(plan.reason).toContain('只剩提交/打标/推送')
  })

  it('② 上次已确认 bump、还没消费 ⇒ consume-intents（状态文件唯一生效的一档）', () => {
    const plan = planRelease(facts({ stateStep: 'consume-intents', pendingIntents: 3 }))
    expect(plan.step).toBe('consume-intents')
    expect(plan.tag).toBe('v1.0.0')
    expect(plan.reason).toContain('3 个意图仍在')
  })

  it('② 状态文件说 consume-intents 但意图已经没了 ⇒ 不生效（不依赖本机记忆）', () => {
    expect(planRelease(facts({ stateStep: 'consume-intents', pendingIntents: 0 })).step).not.toBe('consume-intents')
  })

  it('③ 有未消费意图 ⇒ confirm-bump', () => {
    const plan = planRelease(facts({ pendingIntents: 2 }))
    expect(plan.step).toBe('confirm-bump')
    expect(plan.reason).toContain('2 个待消费变更意图')
  })

  it('④ 本地有 tag 但远端没有 ⇒ commit-tag-push（补推）', () => {
    const plan = planRelease(facts({ localTagExists: true, remoteTagExists: false }))
    expect(plan.step).toBe('commit-tag-push')
    expect(plan.reason).toContain('本地已有标签 v1.0.0 但远端没有')
  })

  it('⑤ 远端与本地都有 tag、分支未推、且未推送的提交正是 release 提交 ⇒ commit-tag-push', () => {
    const plan = planRelease(facts({
      localTagExists: true,
      remoteTagExists: true,
      branchPushed: false,
      releaseCommit: 'v1.0.0',
    }))
    expect(plan.step).toBe('commit-tag-push')
    expect(plan.reason).toContain('补推分支')
  })

  it('⑤ 分支未推但 HEAD 不是 release 提交 ⇒ 不越权去推（交给 git push）', () => {
    const plan = planRelease(facts({
      localTagExists: true,
      remoteTagExists: true,
      branchPushed: false,
      releaseCommit: null,
      commitsSinceTag: 0,
    }))
    expect(plan.step).toBe('done')
  })

  it('⑥ 远端已有 tag 且有新提交 ⇒ generate-intents（向前走，发下一个版本）', () => {
    const plan = planRelease(facts({ remoteTagExists: true, commitsSinceTag: 4 }))
    expect(plan.step).toBe('generate-intents')
    expect(plan.reason).toContain('4 个新提交')
    expect(plan.reason).toContain('v1.0.0')
  })

  it('⑦ 远端已有 tag 且没有新提交 ⇒ done', () => {
    const plan = planRelease(facts({ remoteTagExists: true, commitsSinceTag: 0 }))
    expect(plan.step).toBe('done')
    expect(plan.reason).toContain('没有要做的')
  })

  it('⑧ 什么都没有（首次发版 / 全新 clone）⇒ generate-intents', () => {
    const plan = planRelease(facts({ baseTag: null, baseVersion: null, currentVersion: '1.0.0' }))
    expect(plan.step).toBe('generate-intents')
    expect(plan.reason).toContain('无待消费意图且版本未变')
  })

  it('每一档返回的 tag 都是 v<currentVersion>', () => {
    const cases: ReleaseFacts[] = [
      facts({ currentVersion: '2.3.4', bumpUncommitted: true }),
      facts({ currentVersion: '2.3.4' }),
      facts({ currentVersion: '2.3.4', pendingIntents: 1 }),
      facts({ currentVersion: '2.3.4', stateStep: 'consume-intents', pendingIntents: 1 }),
      facts({ currentVersion: '2.3.4', localTagExists: true }),
      facts({ currentVersion: '2.3.4', remoteTagExists: true }),
      facts({ currentVersion: '2.3.4', remoteTagExists: true, commitsSinceTag: 1 }),
    ]
    for (const item of cases)
      expect(planRelease(item).tag).toBe('v2.3.4')
  })
})

describe('planRelease —— 顺序不变式（这一条不能动）', () => {
  it('「已 bump」必须赢过「还有待消费意图」：否则会在已 bump 的版本上再 bump 一档', () => {
    // 消费只删了一半意图时的真实形态：版本已经变了，但台账里还剩几个意图。
    const plan = planRelease(facts({
      currentVersion: '1.1.0',
      baseVersion: '1.0.0',
      pendingIntents: 3,
      stateStep: 'consume-intents',
      bumpUncommitted: false,
    }))
    expect(plan.step, '「已 bump」被「待消费意图」盖过 ⇒ 重跑会把 v1.1.0 再 bump 成 v1.2.0').toBe('commit-tag-push')

    // 同样的事实、只是还没提交：也必须停在「已 bump」那一档
    const uncommitted = planRelease(facts({
      currentVersion: '1.1.0',
      baseVersion: '1.0.0',
      pendingIntents: 3,
      stateStep: 'consume-intents',
      bumpUncommitted: true,
    }))
    expect(uncommitted.step).toBe('confirm-summary')
  })

  it('「有待消费意图」赢过「本地 tag 缺失」与「远端 tag 已有」', () => {
    expect(planRelease(facts({ pendingIntents: 1, localTagExists: true })).step).toBe('confirm-bump')
    expect(planRelease(facts({ pendingIntents: 1, remoteTagExists: true, commitsSinceTag: 5 })).step).toBe('confirm-bump')
  })
})

describe('describeStep —— 六个步骤的人话说明', () => {
  const TEXT: Record<ReleaseStep, string> = {
    'generate-intents': '扫描 commit 生成变更意图',
    'confirm-bump': '确认版本升级类型（major / minor / patch）',
    'consume-intents': '消费意图：pnpm version -r（改版本 + 写 ledger）',
    'confirm-summary': '输出本次变更总览并等你确认',
    'commit-tag-push': '提交版本变更 → 跑门禁 → 打 tag → 推分支与 tag',
    'done': '已完成',
  }

  it('每一步都有非空、互不相同的说明', () => {
    const steps = Object.keys(TEXT) as ReleaseStep[]
    const texts = steps.map(step => describeStep(step))
    for (const step of steps)
      expect(describeStep(step), `${step} 应当有说明`).toBe(TEXT[step])
    expect(new Set(texts).size).toBe(steps.length)
  })
})

describe('extractChangelogSection —— 逐字匹配 `## <版本>`', () => {
  const CHANGELOG = [
    '# @walnut/admin',
    '',
    '## 1.2.0',
    '',
    '- 新东西',
    '',
    '### 子标题',
    '',
    '- 还在同一段里',
    '',
    '## 1.1.0',
    '',
    '- 旧东西',
    '',
  ].join('\n')

  it('取到该版本段，并在下一个 `## ` 处停下（`### ` 不算边界）', () => {
    expect(extractChangelogSection(CHANGELOG, '1.2.0')).toBe([
      '## 1.2.0',
      '',
      '- 新东西',
      '',
      '### 子标题',
      '',
      '- 还在同一段里',
    ].join('\n'))
  })

  it('最后一段取到文件末尾', () => {
    expect(extractChangelogSection(CHANGELOG, '1.1.0')).toBe(['## 1.1.0', '', '- 旧东西'].join('\n'))
  })

  it('标题必须逐字相同：`## [1.2.0]` / `## 1.2.00` / `## 1.2` 都不算', () => {
    expect(extractChangelogSection('# a\n\n## [1.2.0]\n\n- x\n', '1.2.0')).toBeNull()
    expect(extractChangelogSection('# a\n\n## 1.2.00\n\n- x\n', '1.2.0')).toBeNull()
    expect(extractChangelogSection('# a\n\n## 1.2\n\n- x\n', '1.2.0')).toBeNull()
  })

  it('版本不在文件里 ⇒ null', () => {
    expect(extractChangelogSection(CHANGELOG, '9.9.9')).toBeNull()
    expect(extractChangelogSection('', '1.0.0')).toBeNull()
  })

  it('只有标题的空段仍然返回标题（是否「有条目」由 hasEntries 判）', () => {
    expect(extractChangelogSection('# a\n\n## 1.2.0\n', '1.2.0')).toBe('## 1.2.0')
  })
})

describe('releaseNoteSource / buildReleaseNotes —— 三档正文', () => {
  const SUMMARIES = [
    { packages: ['@walnut/admin', '@walnut/utils'], summary: 'minor: 支持记住登录状态' },
    { packages: [], summary: 'patch: 修掉分页' },
  ]

  it('第一档：cliff 渲染可用', () => {
    const input = { version: '1.2.0', cliffNotes: '## 1.2.0\n\n- 新东西', summaries: SUMMARIES }
    expect(releaseNoteSource(input)).toBe('cliff')
    expect(buildReleaseNotes(input)).toBe('## 1.2.0\n\n- 新东西\n\n---\n由 `pnpm release` 生成（v1.2.0）。')
  })

  it('第二档：cliff 渲不出来 ⇒ 退回意图摘要', () => {
    const input = { version: '1.2.0', cliffNotes: null, summaries: SUMMARIES }
    expect(releaseNoteSource(input)).toBe('intents')
    expect(buildReleaseNotes(input)).toBe([
      '## v1.2.0',
      '',
      '- minor: 支持记住登录状态（@walnut/admin, @walnut/utils）',
      '- patch: 修掉分页',
      '',
      '---',
      '由 `pnpm release` 生成（cliff 渲染不可用，退回意图摘要）。',
    ].join('\n'))
  })

  it('第三档：没有任何条目 ⇒ 占位说明（绝不写空文件）', () => {
    const input = { version: '1.2.0', cliffNotes: null, summaries: [] }
    expect(releaseNoteSource(input)).toBe('placeholder')
    expect(buildReleaseNotes(input)).toBe('## v1.2.0\n\n本次发版没有可摘录的变更条目。\n\n---\n由 `pnpm release` 生成。')
  })

  it('空字符串的 cliffNotes 与 null 同档（判据是「有没有内容」）', () => {
    expect(releaseNoteSource({ version: '1.2.0', cliffNotes: '', summaries: SUMMARIES })).toBe('intents')
    expect(releaseNoteSource({ version: '1.2.0', summaries: SUMMARIES })).toBe('intents')
  })

  it('判据与正文同源：每一档的正文都带着判据自身的特征', () => {
    const tiers: ReleaseNoteInput[] = [
      { version: '1.2.0', cliffNotes: '## 1.2.0\n\n- x', summaries: SUMMARIES },
      { version: '1.2.0', cliffNotes: null, summaries: SUMMARIES },
      { version: '1.2.0', cliffNotes: null, summaries: [] },
    ]
    for (const input of tiers) {
      const source = releaseNoteSource(input)
      const body = buildReleaseNotes(input)
      expect(body.length).toBeGreaterThan(0)
      if (source === 'placeholder')
        expect(body).toContain('没有可摘录的变更条目')
      else
        expect(body).toContain('1.2.0')
    }
  })
})
