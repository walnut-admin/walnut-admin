/**
 * 推送前门禁表（`src/ci/prepush.ts`）的机械审计。
 *
 * 集中到一张表之后，**新的失败模式是表里写错**（脚本名打错、`why` 敷衍、id 重名）—— 而这些
 * 一旦错就会**静默地少跑一道闸**，正是本仓最忌讳的形态。所以这里的用例重点不是「跑得对」，
 * 而是「表本身站得住」：每个 `argv` 都得能落到根 `package.json` 里真实存在的脚本上。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { formatLine, PREPUSH_GATES } from '../prepush.ts'

const rootManifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const rootScripts = new Set(Object.keys(rootManifest.scripts ?? {}))

/** `argv[0]` 是 pnpm 自己的子命令（不是根脚本名）时，这几个是合法的例外 */
const PNPM_SUBCOMMANDS = new Set(['exec', 'change'])

describe('pREPUSH_GATES —— 表本身', () => {
  it('id 无重复且都非空', () => {
    const ids = PREPUSH_GATES.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids)
      expect(id, 'id 不能为空').not.toBe('')
  })

  it('每一段的 argv 都能落到**真实存在**的根脚本 / pnpm 子命令上', () => {
    // 这条守卫就是「表里打错一个脚本名」的拦网：那种错会让整段门禁静默消失。
    for (const gate of PREPUSH_GATES) {
      const head = gate.argv[0]
      expect(head, `${gate.id}: argv 不能为空`).toBeTruthy()
      if (PNPM_SUBCOMMANDS.has(head!)) {
        expect(gate.argv.length, `${gate.id}: pnpm 子命令不该只有一段`).toBeGreaterThan(1)
        continue
      }
      expect(rootScripts.has(head!), `${gate.id}: 根 package.json 里没有脚本 \`${head}\``).toBe(true)
    }
  })

  it('每一段都写清了「凭什么」（理由不许敷衍）', () => {
    for (const gate of PREPUSH_GATES) {
      expect(gate.why.length, `${gate.id} 的理由太短`).toBeGreaterThan(25)
      expect(gate.label.length, `${gate.id} 的标签太短`).toBeGreaterThan(0)
    }
  })

  it('顺序与 id 稳定 —— 整表列出，不是抽样', () => {
    // 表里的顺序是「读起来该怎么理解」，不是依赖关系（并行跑）。改动它应该是**有意的**。
    expect(PREPUSH_GATES.map(g => g.id)).toEqual([
      'boundaries',
      'lint-root',
      'types',
      'types-root',
      'syncpack',
      'workflows',
      'docs-refs',
      'adr',
      'doc-ts',
      'doc-budget',
      'turbo-cache',
      'lockfile',
      'nginx-headers',
      'exports',
      'secrets',
      'versioning',
    ])
  })

  it('段数不是 0（空表 = 推送前什么都不跑，且不会有任何提示）', () => {
    expect(PREPUSH_GATES.length).toBeGreaterThan(5)
  })
})

describe('formatLine —— 结果行', () => {
  const gate = { id: 'x', label: '某段门禁', argv: ['x'], why: 'y'.repeat(30) }

  it('通过打 ✓、失败打 ✗，并带上秒数', () => {
    expect(formatLine({ gate, ok: true, ms: 1234, output: '' })).toBe('  ✓    1.2s  某段门禁')
    expect(formatLine({ gate, ok: false, ms: 12_340, output: '' })).toBe('  ✗   12.3s  某段门禁')
  })

  it('秒数右对齐（否则这一列参差不齐，正是要修的可读性问题）', () => {
    const short = formatLine({ gate, ok: true, ms: 900, output: '' })
    const long = formatLine({ gate, ok: true, ms: 12_300, output: '' })
    expect(short.indexOf('某段门禁')).toBe(long.indexOf('某段门禁'))
  })
})
