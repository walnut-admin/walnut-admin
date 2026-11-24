/**
 * 文本构造（纯函数）—— 断言**内容性质**而不是整段散文。
 *
 * 这些文案是给人判断「要不要按 y」用的，所以「少了哪一行」才是缺陷：
 * 版本怎么变、推哪些 ref、提交多少文件、无关改动会不会被一起带上。
 */

import type { Intent } from '../intents.ts'
import type { StatusInput, SummaryInput } from '../report.ts'
import { describe, expect, it } from 'vitest'
import { abortHintLines, dryRunGenerateLines, statusLines, summaryLines } from '../report.ts'

function intent(overrides: Partial<Intent> = {}): Intent {
  return {
    file: 'auto-1a82770.md',
    packages: ['@walnut/admin'],
    bump: 'minor',
    summary: '1a82770 ::: feat ::: admin: 支持记住登录状态',
    ...overrides,
  }
}

function summaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    entries: [intent()],
    oldVersion: '1.0.0',
    newVersion: '1.1.0',
    bump: 'minor',
    baseTag: 'v1.0.0',
    branch: 'main',
    changedCount: 17,
    unrelated: [],
    batteryCount: 7,
    batterySkipped: 1,
    tokenMasked: null,
    ...overrides,
  }
}

function statusInput(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    planOnly: false,
    currentVersion: '1.0.0',
    baseTag: 'v1.0.0',
    baseVersion: '1.0.0',
    branch: 'main',
    branchPushed: true,
    pendingIntents: 0,
    versionConsumed: false,
    localTagExists: false,
    remoteTagExists: false,
    remoteReleaseExists: false,
    releaseChecked: false,
    tag: 'v1.0.0',
    step: 'generate-intents',
    stepText: '扫描 commit 生成变更意图',
    reason: '无待消费意图且版本未变',
    unrelated: [],
    groupMisaligned: [],
    state: null,
    ...overrides,
  }
}

describe('summaryLines —— 确认前必须说清的四件事', () => {
  it('版本箭头 / 标签 / 将提交文件数 / 条目数都在', () => {
    const text = summaryLines(summaryInput()).join('\n')
    expect(text).toContain('v1.0.0 → v1.1.0（minor）')
    expect(text).toContain('标签 v1.1.0')
    expect(text).toContain('将提交    17 个文件')
    expect(text).toContain('变更条目  1 条')
    expect(text).toContain('基线 tag  v1.0.0')
    expect(text).toContain('git push --atomic origin main v1.1.0')
  })

  it('首次发版（没有基线 tag）明确写出来，不留空白', () => {
    expect(summaryLines(summaryInput({ baseTag: null })).join('\n')).toContain('（无，首次发版）')
  })

  it('列出每一个无关改动文件', () => {
    const unrelated = ['apps/admin/src/a.ts', 'turbo.json', '.github/workflows/ci.yml']
    const text = summaryLines(summaryInput({ unrelated })).join('\n')
    expect(text).toContain('与发版无关的改动 3 个（**会被一并提交**，想分开就先 stash）')
    for (const file of unrelated)
      expect(text, `无关改动 ${file} 必须在总览里出现`).toContain(`· ${file}`)
  })

  it('无关改动超过 12 个时列出前 12 个 + 「另有 N 个」', () => {
    const unrelated = Array.from({ length: 15 }, (_, index) => `file-${index + 1}.ts`)
    const lines = summaryLines(summaryInput({ unrelated }))
    const text = lines.join('\n')
    expect(text).toContain('· file-1.ts')
    expect(text).toContain('· file-12.ts')
    expect(text).not.toContain('· file-13.ts')
    expect(text).toContain('· … 另有 3 个')
  })

  it('没有无关改动时不出现那一段', () => {
    expect(summaryLines(summaryInput({ unrelated: [] })).join('\n')).not.toContain('与发版无关的改动')
  })

  it('条目超过 12 条时列出前 12 条 + 「另有 N 条」', () => {
    const entries = Array.from({ length: 14 }, (_, index) => intent({ file: `auto-${index}.md`, summary: `commit ${index}` }))
    const text = summaryLines(summaryInput({ entries })).join('\n')
    expect(text).toContain('变更条目  14 条')
    expect(text).toContain('… 另有 2 条')
  })

  it('超长摘要被截断（不把总览刷屏）', () => {
    const long = 'x'.repeat(200)
    const text = summaryLines(summaryInput({ entries: [intent({ summary: long })] })).join('\n')
    expect(text).toContain('…')
    expect(text).not.toContain(long)
  })

  it('token 有无走两条不同的说明', () => {
    expect(summaryLines(summaryInput({ tokenMasked: 'ghp_****mnop' })).join('\n')).toContain('git-cliff 用 ghp_****mnop 补 PR 号与作者')
    expect(summaryLines(summaryInput({ tokenMasked: null })).join('\n')).toContain('未提供 GITHUB_TOKEN')
  })

  it('暂缓的电池条数只在有暂缓项时才提', () => {
    expect(summaryLines(summaryInput({ batterySkipped: 1 })).join('\n')).toContain('另有 1 条按配置暂缓')
    expect(summaryLines(summaryInput({ batterySkipped: 0 })).join('\n')).not.toContain('按配置暂缓')
  })
})

describe('dryRunGenerateLines —— 演练横幅', () => {
  const input = { generated: 3, target: '1.1.0', bump: 'minor', bumpOverridden: false, batteryCount: 7 }

  it('绝不出现与「将生成 N 个意图」自相矛盾的两句话', () => {
    // 这就是那个被记录过的缺陷：两句并列会让一次演练被读成「没有可发布的东西」
    const text = dryRunGenerateLines(input).join('\n')
    expect(text).not.toContain('无需发版')
    expect(text).not.toContain('没有可生成的变更记录')
  })

  it('说清「只演练到第 1 步」、目标版本与后续会跑什么', () => {
    const text = dryRunGenerateLines(input).join('\n')
    expect(text).toContain('--dry-run：只演练到第 1 步（零写盘）')
    expect(text).toContain('将生成     3 个意图')
    expect(text).toContain('目标版本   v1.1.0（minor，自动检测）')
    expect(text).toContain('发版前全量电池 7 条')
    expect(text).toContain('正式执行：pnpm release')
  })

  it('--bump 覆盖时标注出来', () => {
    expect(dryRunGenerateLines({ ...input, bump: 'major', bumpOverridden: true }).join('\n')).toContain('（major，由 --bump 指定）')
  })
})

describe('abortHintLines —— 中断后「重跑怎么接」', () => {
  it('明确说重跑能从断点接上', () => {
    const text = abortHintLines({ signal: 'SIGINT', plan: { step: 'commit-tag-push', reason: '只剩提交' }, state: null }).join('\n')
    expect(text).toContain('收到 SIGINT 已停手')
    expect(text).toContain('直接重跑 pnpm release 即可从断点接上')
    expect(text).toContain('commit-tag-push')
    expect(text).toContain('git checkout -- . && git clean -fd .changeset')
  })

  it('按事实重算失败时说明退回状态文件的说法，并带上状态文件内容', () => {
    const text = abortHintLines({
      signal: 'SIGTERM',
      plan: null,
      state: { nextStep: 'consume-intents', toVersion: '1.1.0', bump: 'minor', updatedAt: '2026-01-01T00:00:00.000Z' },
    }).join('\n')
    expect(text).toContain('按事实重算下一步失败')
    expect(text).toContain('下一步 consume-intents，目标 v1.1.0（minor）')
    expect(text).toContain('直接重跑 pnpm release')
  })
})

describe('statusLines —— 只读面', () => {
  it('--plan 与 --status 只差标题', () => {
    expect(statusLines(statusInput()).join('\n')).toContain('发版状态')
    expect(statusLines(statusInput({ planOnly: true })).join('\n')).toContain('发版计划（零写盘）')
  })

  it('release 探测失败时说「未查询」，不谎称「远端没有」', () => {
    const text = statusLines(statusInput({ releaseChecked: false })).join('\n')
    expect(text).toContain('未查询')
    expect(text).not.toContain('远端还没有')
  })

  it('探测成功时给出两种确定说法', () => {
    expect(statusLines(statusInput({ releaseChecked: true, remoteReleaseExists: true })).join('\n')).toContain('远端已有')
    expect(statusLines(statusInput({ releaseChecked: true, remoteReleaseExists: false })).join('\n')).toContain('远端还没有（由 release.yml 创建）')
  })

  it('fixed 组没对齐时打出半升级块与修法', () => {
    const lines = statusLines(statusInput({ groupMisaligned: ['@walnut/ui（0.0.1）', '@walnut/http（0.0.1）'] }))
    const text = lines.join('\n')
    expect(text).toContain('❌ 工作区不是可发版状态：fixed 组有 2 个包没对齐到 v1.0.0')
    expect(text).toContain('· @walnut/ui（0.0.1）')
    expect(text).toContain('· @walnut/http（0.0.1）')
    expect(text).toContain('修法：git checkout -- . 把改动全部还原')
  })

  it('没对齐的包超过 20 个时截断', () => {
    const groupMisaligned = Array.from({ length: 22 }, (_, index) => `@walnut/pkg-${index}（0.0.1）`)
    const text = statusLines(statusInput({ groupMisaligned })).join('\n')
    expect(text).toContain('另有 2 个')
    expect(text).not.toContain('@walnut/pkg-21')
  })

  it('无关改动与状态文件都列出来', () => {
    const text = statusLines(statusInput({
      unrelated: ['turbo.json'],
      state: { nextStep: 'consume-intents', toVersion: '1.1.0', bump: 'minor', updatedAt: '2026-01-01T00:00:00.000Z' },
      versionConsumed: true,
      branchPushed: false,
    })).join('\n')
    expect(text).toContain('与发版无关的改动 1 个（会被一并提交）')
    expect(text).toContain('· turbo.json')
    expect(text).toContain('.changeset/.release-state.json')
    expect(text).toContain('下一步    generate-intents')
    expect(text).toContain('上次记的下一步  consume-intents')
    expect(text).toContain('目标 v1.1.0（minor）')
    expect(text).toContain('ledger 有未提交改动')
    expect(text).toContain('（有未推送提交）')
  })
})
