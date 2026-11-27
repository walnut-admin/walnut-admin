/**
 * `scripts/freshness.ts` 的纯函数部分：从读数里挑出「产物落后源码」的条目。
 *
 * 为什么只测这一半：`computeArtifactFreshness` 直接碰 git 与文件系统（是可重跑的环境读数，
 * 不是可断言的纯逻辑）；`staleArtifacts` 是 preflight 告警文案的**唯一判据**，值得钉住 ——
 * 它错成「永远返回空」时，产物过期就会重新变成静默。
 */
import { describe, expect, it } from 'vitest'
import { staleArtifacts } from './freshness.ts'

function freshness(lag: { adminIndex: number | null, serverMain: number | null }) {
  return {
    sourceCommitSeconds: 1_700_000_000,
    sourceCommitAt: '2023-11-14T22:13:20.000Z',
    artifactAgeMinutes: { adminIndex: 30, serverMain: 1440 },
    artifactLagMinutes: lag,
  }
}

describe('staleArtifacts', () => {
  it('两处都落后 ⇒ 两条提示，各自带修复命令', () => {
    const notes = staleArtifacts(freshness({ adminIndex: 15, serverMain: 1440 }))
    expect(notes.map(note => note.name)).toEqual([
      'apps/admin/dist-staging/index.html',
      'apps/server/dist-stage/apps/api/src/main.js',
    ])
    expect(notes[0]?.lagMinutes).toBe(15)
    expect(notes[0]?.fix).toContain('build:stage')
    expect(notes[1]?.fix).toContain('@walnut/server')
  })

  it('落后 0 分钟（产物不旧于源码）⇒ 不告警', () => {
    expect(staleArtifacts(freshness({ adminIndex: 0, serverMain: 0 }))).toEqual([])
  })

  it('产物缺失（null）⇒ 不在这里告警（缺失由 preflight 的硬检查负责）', () => {
    expect(staleArtifacts(freshness({ adminIndex: null, serverMain: null }))).toEqual([])
  })

  it('只落后一处 ⇒ 只报那一处', () => {
    const notes = staleArtifacts(freshness({ adminIndex: 0, serverMain: 7 }))
    expect(notes).toHaveLength(1)
    expect(notes[0]?.lagMinutes).toBe(7)
  })
})
