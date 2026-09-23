/**
 * 第 4–5 步（steps.ts）：全量电池表的机械审计 + 顺序不变式的源码断言。
 *
 * ⚠️ 本套用例**刻意不调** `runReleaseGates` / `runReleaseBattery`：它们会真的起子进程
 * （pnpm / turbo），既需要仓库状态，也远超单测该碰的边界。要钉的性质用两种方式拿：
 *   ① 表本身通过导出的纯函数读（`releaseBatteryArgvs` / `releaseBatteryIds` …）；
 *   ② 顺序不变式（门禁在打 tag **之前**）用源码文本的索引断言。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  releaseBatteryArgvs,
  releaseBatteryCount,
  releaseBatteryIds,
  releaseBatterySkippedCount,
  releaseBatterySkips,
} from '../steps.ts'

describe('releaseBatteryArgvs —— 会跑的那几行', () => {
  it('表非空，且每一行都是非空字符串数组（表被改成空数组会当场失败）', () => {
    const argvs = releaseBatteryArgvs()
    expect(argvs.length).toBeGreaterThan(0)
    for (const argv of argvs) {
      expect(Array.isArray(argv)).toBe(true)
      expect(argv.length).toBeGreaterThan(0)
      for (const token of argv)
        expect(token.length).toBeGreaterThan(0)
    }
  })

  it('逐行钉住会跑的电池（顺序即执行顺序）', () => {
    expect(releaseBatteryArgvs()).toEqual([
      ['boundaries'],
      ['exec', 'turbo', 'run', 'lint'],
      ['lint:root'],
      ['exec', 'turbo', 'run', 'types:check'],
      ['types:check:root'],
      ['exec', 'turbo', 'run', 'test'],
      ['syncpack:lint'],
      ['change', 'check'],
      ['lint:workflows'],
      ['lint:docs-refs'],
      ['lint:adr'],
    ])
  })

  it('根级 lint 是**独立一行**且经根脚本跑，绝不混进 turbo 的 argv', () => {
    const argvs = releaseBatteryArgvs()
    // `lint:root` 只是根 package.json 的脚本，不是 turbo 任务：
    // `turbo run lint lint:root` 会 `Could not find task \`lint:root\` in project` 当场退 1
    // （实测），于是整条电池在打 tag 之前失败、每次都拦下发版。
    expect(argvs).toContainEqual(['lint:root'])
    for (const argv of argvs) {
      if (argv.includes('turbo')) {
        expect(argv, `turbo 的 argv 不得包含 lint:root：${argv.join(' ')}`).not.toContain('lint:root')
      }
    }
  })

  it('暂缓的 build 不在会跑的序列里', () => {
    expect(releaseBatteryArgvs()).not.toContainEqual(['build'])
  })

  it('返回的是拷贝：改它不影响下一次调用', () => {
    const first = releaseBatteryArgvs()
    first[0]?.push('被污染的 token')
    expect(releaseBatteryArgvs()[0]).not.toContain('被污染的 token')
  })
})

describe('电池计数与 id 集合', () => {
  it('会跑的条数 + 暂缓的条数 = 整表长度', () => {
    const tableLength = releaseBatteryIds().length
    expect(releaseBatteryCount() + releaseBatterySkippedCount()).toBe(tableLength)
    expect(releaseBatteryArgvs().length).toBe(releaseBatteryCount())
  })

  it('id 无重复且都非空', () => {
    const ids = releaseBatteryIds()
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids)
      expect(id.length).toBeGreaterThan(0)
  })

  it('被暂缓的只有 build 一行，且暂缓理由写在表里（不是静默少跑）', () => {
    const skips = releaseBatterySkips()
    expect(skips.map(item => item.id)).toEqual(['build'])
    expect(skips[0]?.skip.length).toBeGreaterThan(0)
    expect(releaseBatterySkippedCount()).toBe(1)
  })
})

describe('顺序不变式：门禁必须在打 tag **之前**', () => {
  // 从**本用例自己的位置**推模块路径，而不是写死仓库相对路径：
  // 写死的那版在「release 从 packages/tooling/scripts 拆成独立包」时当场失效（ENOENT），
  // 而它要断言的其实是「同一目录下的 steps.ts」——这个关系不随包搬家改变。
  const SOURCE_PATH = path.resolve(import.meta.dirname, '../steps.ts')

  it('源码里 `runReleaseGates()` 的调用早于打 tag 的 argv 字面量', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    const gateIndex = source.indexOf('await runReleaseGates(')
    const tagArgvIndex = source.indexOf('\'tag\',')

    expect(gateIndex, '`await runReleaseGates(` 必须出现在 steps.ts 里（Step 5 的门禁调用）').toBeGreaterThan(-1)
    expect(tagArgvIndex, '`\'tag\',` 这个 argv 字面量必须出现在 steps.ts 里（创建标签的命令）').toBeGreaterThan(-1)
    expect(
      gateIndex < tagArgvIndex,
      `门禁必须在打 tag 之前跑：runReleaseGates() 在第 ${gateIndex} 个字符处，tag argv 在第 ${tagArgvIndex} 个字符处。`
      + '顺序反了会让「本地全绿、发版成功、CI 的 verify 却红」变成可达 —— 那时远端已经有一个指向坏提交的 tag。',
    ).toBe(true)
  })

  it('推送用的是 --atomic（分支与 tag 要么一起成功、要么都不动）', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    expect(source).toContain('\'--atomic\'')
  })
})
