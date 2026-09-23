/**
 * 机械审计**真实仓库**的 git 钩子配置（`lefthook.yml` + 根 `package.json`）。
 *
 * 为什么这些断言值得存在：钩子安装是**静默失败**的经典形态，而 Windows 上的双引号缺陷是
 * 「带引号的命令会静默丢参、还照样报 ✓」（lefthook 用 `cmd.exe` 拼行、内层引号未转义）。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { REPO_ROOT } from '../../lib/repo-root.ts'

interface LefthookJob {
  name?: string
  run?: string
}

interface LefthookHook {
  jobs?: LefthookJob[]
}

interface LefthookConfig {
  min_version?: string
  assert_lefthook_installed?: boolean
}

const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const

const config = parse(readFileSync(path.join(REPO_ROOT, 'lefthook.yml'), 'utf8')) as LefthookConfig & Record<string, unknown>

const rootManifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
}

function jobsOf(hook: string): LefthookJob[] {
  return (config[hook] as LefthookHook | undefined)?.jobs ?? []
}

describe('lefthook.yml —— 基本形状', () => {
  it('min_version 存在且是完整版本号', () => {
    expect(typeof config.min_version).toBe('string')
    expect(config.min_version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('assert_lefthook_installed === true（shim 找不到二进制时必须响亮失败）', () => {
    expect(config.assert_lefthook_installed).toBe(true)
  })

  it('三个钩子都存在且各自至少有一个 job', () => {
    for (const hook of HOOKS) {
      expect(config[hook], `${hook} 必须存在（否则那条门禁整条消失）`).toBeDefined()
      expect(jobsOf(hook).length, `${hook} 至少要有一个 job`).toBeGreaterThan(0)
    }
  })
})

describe('lefthook.yml —— Windows 双引号缺陷', () => {
  it('所有 job 的 run 里都不含双引号', () => {
    const offenders: string[] = []
    for (const hook of HOOKS) {
      for (const job of jobsOf(hook)) {
        if (typeof job.run === 'string' && job.run.includes('"'))
          offenders.push(`${hook}/${job.name ?? '(未命名)'} → ${job.run}`)
      }
    }
    expect(
      offenders,
      `这些 job 的 run 里含双引号：Windows 上 lefthook 经 cmd.exe 拼命令行、内层引号未转义 ⇒ 命令会**静默丢参、还照样报 ✓**（上游 PR #1464 未合并）。改成不含引号的写法：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('每个 job 都有 run（空 job 等于没跑）', () => {
    for (const hook of HOOKS) {
      for (const job of jobsOf(hook))
        expect(typeof job.run === 'string' && job.run.length > 0, `${hook} 的 job 必须有 run`).toBe(true)
    }
  })
})

describe('lefthook.yml —— pre-push 是单条聚合门禁', () => {
  it('恰好一个 job，且 run 就是 `pnpm --silent prepush`', () => {
    const jobs = jobsOf('pre-push')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.run).toBe('pnpm --silent prepush')
  })

  it('pre-commit 与 commit-msg 各自绑定 lint-staged / commitlint', () => {
    expect(jobsOf('pre-commit').map(job => job.run)).toEqual(['pnpm exec lint-staged'])
    expect(jobsOf('commit-msg').map(job => job.run)).toEqual(['pnpm exec commitlint --edit {1}'])
  })
})

describe('根 package.json —— 钩子与门禁脚本', () => {
  it('没有 simple-git-hooks 键（已迁到 lefthook）', () => {
    expect(Object.keys(rootManifest)).not.toContain('simple-git-hooks')
    expect(JSON.stringify(rootManifest)).not.toContain('simple-git-hooks')
  })

  it('有 prepush 脚本，且十段门禁按序都在里面', () => {
    const prepush = rootManifest.scripts?.prepush ?? ''
    expect(prepush.length).toBeGreaterThan(0)
    // 整表列出（不是抽样）：prepush 是**唯一**的推送前门禁，少一段就是少一道闸。
    // 段数变过多次（五 → 六 → 七 → 八 → 九 → 十），每加一段都在这里登记。
    const gates = [
      'pnpm boundaries',
      'pnpm lint:root',
      'pnpm types:check',
      'pnpm types:check:root',
      'pnpm syncpack:lint',
      'pnpm lint:workflows',
      'pnpm lint:docs-refs',
      'pnpm lint:adr',
      'pnpm lint:doc-ts',
      'pnpm change check',
    ]
    for (const gate of gates)
      expect(prepush, `prepush 里缺 ${gate}`).toContain(gate)
    const positions = gates.map(gate => prepush.indexOf(gate))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('hooks:check 就是 walnut-check-git-hooks（装没装上要能机械核对）', () => {
    expect(rootManifest.scripts?.['hooks:check']).toBe('walnut-check-git-hooks')
  })

  it('lefthook 是根 devDependency（钩子由它的 postinstall 安装）', () => {
    expect(rootManifest.devDependencies?.lefthook).toBeTruthy()
  })
})
