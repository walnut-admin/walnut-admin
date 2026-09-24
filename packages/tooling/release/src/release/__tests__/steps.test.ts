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
import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'
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
      ['hooks:check'],
      ['boundaries'],
      ['exec', 'turbo', 'run', 'lint'],
      ['exec', 'turbo', 'run', 'lint:root'],
      ['exec', 'turbo', 'run', 'types:check'],
      ['types:check:root'],
      ['exec', 'turbo', 'run', 'test'],
      ['syncpack:lint'],
      ['change', 'check'],
      ['lint:workflows'],
      ['lint:docs-refs'],
      ['lint:adr'],
      ['lint:doc-ts'],
      ['lint:doc-budget'],
      ['lint:turbo-cache'],
      ['lint:lockfile'],
      ['lint:nginx-headers'],
      ['lint:secrets'],
      ['lint:exports'],
    ])
  })

  it('根级 lint 走 turbo 根任务 `//#lint:root`，且整条电池里只出现一次', () => {
    const argvs = releaseBatteryArgvs()
    expect(argvs).toContainEqual(['exec', 'turbo', 'run', 'lint:root'])
    // ⚠️ 这条断言 2026-09-23 **翻转**过，留个记录免得下次又改回去：
    // 原先它是 `['lint:root']`（直接跑根脚本），理由是「`lint:root` 只是根 package.json 的脚本、
    // 不是 turbo 任务，`turbo run lint lint:root` 会 `Could not find task` 当场退 1（实测）」。
    // 那条理由当时成立 —— 但根 `turbo.json` 现在**定义了** `//#lint:root`（带精确 inputs，
    // 就是根脚本那三个 glob），`turbo run lint lint:root` 实测 16 个任务、正常跑通。
    // 走 turbo 才有缓存：冷跑 3.8s → 热跑 0.1s（以前每次发版都真跑）。
    const hits = argvs.filter(a => a.join(' ').includes('lint:root'))
    expect(hits, '根级 lint 在电池里只能出现一次').toHaveLength(1)
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

  // 暂缓的**只能是**「本地跑不了 / 要分钟级」的那几条，且每条都要写清理由（不是静默少跑）。
  // 2026-09-23 从 1 条变 2 条：新增的 `dist-secrets`（产物去密体检）与 `build` 是一对 ——
  // 它扫的就是 `apps/admin/dist`，本地没构建时它只会报「前置条件未满足」。
  it('被暂缓的只有 build 与 dist-secrets 两行，且暂缓理由都写在表里', () => {
    const skips = releaseBatterySkips()
    expect(skips.map(item => item.id)).toEqual(['build', 'dist-secrets'])
    for (const item of skips)
      expect(item.skip.length, `${item.id} 没写暂缓理由`).toBeGreaterThan(0)
    expect(releaseBatterySkippedCount()).toBe(2)
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

/**
 * 电池表 ↔ 文档表 的对账。
 *
 * **为什么要有这一段**：`release.md` 里那张表是给人看的（它比源码好读：每行写清了这条门禁
 * 在防什么），但它是**手抄的** —— 文档自己都写着「本页的表格眼下仍靠人工同步」。而这份表的
 * 真源是 `RELEASE_BATTERY`。加一段门禁不加文档、或删了门禁忘了划掉文档那一行，两边就分了岔，
 * 而**读者只会看到文档**。A1（CI↔门禁名册对账）覆盖的是 `.github/workflows` 那一面，
 * 这一段补的就是同一族里剩下的那个人工同步点。
 *
 * 实测（2026-09-23，加这段之前）：两边**已经对齐**，所以它是「上了就是绿的」那种门禁。
 *
 * ⚠️ **它读的是包外的文件**（文档站在 `apps/docs`）。两个已知边界，写在这里免得下次误判：
 *   · 改**只**改那份 md（不动电池）时，CI 的 `test --affected` 不会选中 `@walnut/release`
 *     ⇒ 这一段不会跑。真正要防的方向是反过来的（改了电池忘了改表），那个方向一定会跑到。
 *   · `test` 任务的 inputs 里有一条**否定 glob 把所有 markdown 排除了**（根 `turbo.json`），
 *     所以那份 md 也不进本任务的缓存键。这是刻意的取舍：为一份文档去动全局 inputs 不划算。
 */
describe('release.md 的电池表与 RELEASE_BATTERY 对账', () => {
  const DOC_PATH = path.join(REPO_ROOT, 'apps/docs/src/zh-CN/content/monorepo/release.md')

  /** 取文档里「| id | 内容 |」那张表，返回 `{ id, desc, text }`（保持文档顺序） */
  function docTableRows(): { id: string, desc: string, text: string }[] {
    const lines = readFileSync(DOC_PATH, 'utf8').split('\n')
    const header = lines.findIndex(line => /^\|\s*id\s*\|\s*内容\s*\|/.test(line))
    expect(header, `${DOC_PATH} 里找不到「| id | 内容 |」那张表（表头被改过？）`).toBeGreaterThan(-1)

    const rows: { id: string, desc: string, text: string }[] = []
    for (const line of lines.slice(header + 2)) {
      if (!line.startsWith('|'))
        break
      const matched = /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line)
      expect(matched, `表里有一行的第一格不是 \`id\`：${line.slice(0, 40)}…`).not.toBeNull()
      rows.push({ id: matched![1]!, desc: matched![2]!.trim(), text: line })
    }
    return rows
  }

  it('id 与顺序逐字等于 RELEASE_BATTERY（少一条 / 多一条 / 换位置都会红）', () => {
    expect(docTableRows().map(row => row.id)).toEqual(releaseBatteryIds())
  })

  it('每一行都写了「这条在防什么」，且指向真实命令 / 文件（用反引号引出来）', () => {
    for (const row of docTableRows()) {
      // 刻意不设字符数阈值：那种魔法数字只会误报（第一版写 `> 30`，`test` 那行 29 就挂了）
      expect(row.desc.length, `${row.id} 那行的说明是空的`).toBeGreaterThan(0)
      expect(row.desc, `${row.id} 那行没有用反引号指出它跑的是什么`).toContain('`')
    }
  })

  it('暂缓的条目在文档里也带 ⏭️ 标记（免得读者以为它会跑）', () => {
    const skipped = new Set(releaseBatterySkips().map(item => item.id))
    expect(skipped.size).toBeGreaterThan(0)
    for (const row of docTableRows()) {
      if (skipped.has(row.id))
        expect(row.text, `${row.id} 在电池里是暂缓的，文档那行必须带 ⏭️`).toContain('⏭️')
      else
        expect(row.text, `${row.id} 在电池里会跑，文档那行不该带 ⏭️`).not.toContain('⏭️')
    }
  })
})
