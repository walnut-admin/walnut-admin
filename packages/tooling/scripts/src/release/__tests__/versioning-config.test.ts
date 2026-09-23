/**
 * 机械审计**真实仓库**的版本策略配置。
 *
 * `pnpm-workspace.yaml` 的 `versioning` 段是唯一真源；本套用例是「组成员数必须 == 有 version 的
 * workspace 包数」那条注释（以及「本仓不是 @changesets/cli」那条）的机械拦网。
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { readVersioningConfig, versionedPackages } from '../attribution.ts'

describe('readVersioningConfig —— pnpm-workspace.yaml 的 versioning 段', () => {
  it('fixed 恰好是一个组（单一 fixed 组是整个发版编排的前提）', () => {
    expect(readVersioningConfig().fixed).toHaveLength(1)
  })

  it('组成员数 == 有 version 的 workspace 包数，且两个集合逐名相等', () => {
    const members = [...(readVersioningConfig().fixed[0] ?? [])].sort()
    const versioned = versionedPackages().map(pkg => pkg.name).sort()

    expect(versioned.length).toBeGreaterThan(0)
    expect(members).toHaveLength(versioned.length)
    expect(members).toEqual(versioned)
  })

  it('组里没有重复包名（重复会让锁步判断与审计各说各话）', () => {
    const members = readVersioningConfig().fixed.flat()
    expect(new Set(members).size).toBe(members.length)
  })

  it('changelogStorage 是 registry（changelog 由 git-cliff 逐包写，pnpm 不落文件）', () => {
    expect(readVersioningConfig().changelogStorage).toBe('registry')
  })
})

describe('本仓不使用 @changesets/cli', () => {
  it('.changeset/config.json 不存在（版本策略已搬到 pnpm-workspace.yaml）', () => {
    expect(existsSync(path.join(REPO_ROOT, '.changeset', 'config.json'))).toBe(false)
  })

  it('根 package.json 的 devDependencies 里没有 changesets 相关包', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    const devDependencies = manifest.devDependencies ?? {}
    expect(devDependencies).not.toHaveProperty('@changesets/cli')
    expect(devDependencies).not.toHaveProperty('@changesets/changelog-github')
  })
})
