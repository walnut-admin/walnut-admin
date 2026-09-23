/**
 * 文档字数预算：**常驻上下文**的几个文件不许无限膨胀。
 *
 * 为什么只给这几个文件定预算：它们不是「查了才看」的参考文档，而是**每次会话都要进上下文**的东西
 * —— 根 `AGENTS.md`、它的 shim `CLAUDE.md`、以及每个 app 的包级指引。参考文档越厚越好，
 * 常驻规则越薄越好；这条区别就是本门禁存在的全部理由。官方对单个指引的建议也是 ≤200 行。
 *
 * ## 两个方向都查（这是本门禁的设计要点）
 *
 * ① **超上限 → 失败**：文档膨胀成「多事实混居」了。处置：把细节挪去文档站，只留纪律与指针。
 * ② **用不到上限的一半 → 也失败**：预算是个**会腐烂的常数**（本仓 2026-09-23 一天之内就在文档里
 *    抓到三处烂掉的计数）。一个文件只用掉预算 20% 时，这个数字已经不再约束任何东西 ——
 *    要么把它收紧到贴着现状，要么在 `why` 里说明为什么留这么多余量。
 *    只查上界的门禁会慢慢变成摆设，这正是本仓其它门禁反复强调的「一个开始说废话的门禁等于没有门禁」。
 *
 * ## 为什么用「字符数」而不是「行数」
 *
 * 实测：根 `AGENTS.md` 只有 67 行，却有 8181 字符 —— 本仓的行可以很长（纪律条目一行写上百字）。
 * 行数会给出严重低估的读数，而真正被消耗的是**上下文字符**。
 *
 * ## 没被纳入的文件（有意）
 *
 * `apps/server/AGENTS.md` **不在预算表里**：它 16525 字符 / 509 行，是官方建议（单个指引 ≤200 行）
 * 的 2.5 倍，直接设预算会让门禁当场红、逼着立刻做拆分。拆分本身是对的（文件里已写明做法：
 * 「要拆就按模块拆成 `libs/<x>/AGENTS.md`」），但那是**一次独立的文档重构**，不该混在加门禁这一批里
 * 偷偷做掉 —— 已登记为待办。**刻意写在这里，而不是静默略过。**
 */

import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../lib/repo-root.ts'

export interface DocBudget {
  /** 仓库相对路径 */
  file: string
  /** 字符数上限 */
  maxChars: number
  /** 为什么给它这个数 —— 这一列是给人看的，也是「凭什么」 */
  why: string
}

/**
 * 预算表。**改动这张表就是改门禁**，所以每条都写清楚「凭什么」。
 * 数字贴着现状留约 12% 余量（都落在上限的 88% 上下）；`pnpm lint:doc-budget` 会在用量掉到
 * 一半以下时要求你收紧它。
 *
 * ⚠️ 表里的数字是 **`readFileSync(utf8).length`（UTF-16 码元数）**，不是 PowerShell
 * `Get-Content -Raw` 的读数 —— 两者在本仓对不上（实测 `AGENTS.md`：Node 7521 / PS 8181，
 * 且行数 125 vs 67）。门禁用前者，所以校准也以它为准。
 */
export const DOC_BUDGETS: readonly DocBudget[] = [
  {
    file: 'AGENTS.md',
    maxChars: 8700,
    why: '**每次会话都进上下文**的常驻规则。当前 7644（88%）。它是「只留纪律 + 指针」的那一份，细节都应该在文档站里；再涨就该往下挪。',
  },
  {
    file: 'CLAUDE.md',
    maxChars: 1250,
    why: '**只是一个 shim**（一行 `@AGENTS.md` 导入 + 为什么不能删的说明）。当前 1089（87%）。给它预算的目的就是**把它钉死在 shim 形态**：谁往这里追加规则，这里会先红。',
  },
  {
    file: 'apps/docs/src/zh-CN/content/monorepo/index.md',
    maxChars: 2000,
    why: '文档站「架构」一节的着陆页。当前 1789（89%）。职责只是导航 + 两本账的分工说明，正文归 `architecture.md`（那份**不设**预算 —— 参考文档越厚越好）。',
  },
  {
    file: 'apps/admin/AGENTS.md',
    maxChars: 1950,
    why: 'admin 的包级常驻指引（别名、auto-import 的克制、组件与 store 约定）。当前 1735（89%）。',
  },
  {
    file: 'apps/docs/AGENTS.md',
    maxChars: 4600,
    why: '文档站的包级常驻指引。当前 4022（87%）—— 比别的包级指引厚：本站特有的坑（死链边界、VitePress 的插值语法、会腐烂的计数、围栏语言、字数预算）都装在这一份里。',
  },
]

/** 用量低于上限的这个比例 ⇒ 判定预算已过期 */
export const STALE_RATIO = 0.5

export interface BudgetFinding {
  file: string
  kind: 'over' | 'stale'
  message: string
}

export interface BudgetReport {
  file: string
  chars: number
  maxChars: number
  /** 用量占上限的百分比（四舍五入） */
  percent: number
}

/**
 * 评估预算。**纯函数**：只吃预算表与读取函数，用例直接喂它。
 * 返回 [发现的问题, 全部读数（含通过的，供打印]。
 */
export function evaluateBudgets(
  budgets: readonly DocBudget[],
  readText: (file: string) => string,
): [BudgetFinding[], BudgetReport[]] {
  const findings: BudgetFinding[] = []
  const reports: BudgetReport[] = []

  for (const budget of budgets) {
    const chars = readText(budget.file).length
    const percent = Math.round((chars / budget.maxChars) * 100)
    reports.push({ file: budget.file, chars, maxChars: budget.maxChars, percent })

    if (chars > budget.maxChars) {
      findings.push({
        file: budget.file,
        kind: 'over',
        message: `超预算 ${chars - budget.maxChars} 字符（${chars} / ${budget.maxChars}，${percent}%）。`
          + '处置：把细节挪去文档站，这一份只留纪律与指针；确实是常驻内容才调大上限。',
      })
    }
    else if (chars < budget.maxChars * STALE_RATIO) {
      findings.push({
        file: budget.file,
        kind: 'stale',
        message: `只用了预算的 ${percent}%（${chars} / ${budget.maxChars}）—— 这个上限已经约束不到任何东西了。`
          + '处置：把 `maxChars` 收紧到贴着现状（或写明为什么留这么多余量）。',
      })
    }
  }

  return [findings, reports]
}

export function main(): number {
  if (!fs.existsSync(path.join(REPO_ROOT, 'AGENTS.md'))) {
    console.error('✖ 找不到根 AGENTS.md —— 拒绝把「读不到东西」当绿灯')
    return 2
  }

  const [findings, reports] = evaluateBudgets(
    DOC_BUDGETS,
    file => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  )

  console.log(`文档字数预算：${reports.length} 个常驻文件`)
  for (const r of reports)
    console.log(`  ${String(r.percent).padStart(3)}%  ${String(r.chars).padStart(6)} / ${String(r.maxChars).padEnd(6)}  ${r.file}`)

  if (findings.length === 0) {
    console.log('✅ 都在预算内，且没有哪个预算已经失效')
    return 0
  }

  for (const f of findings)
    console.error(`\n✖ ${f.file}  [${f.kind === 'over' ? '超上限' : '预算过期'}]\n    ${f.message}`)
  console.error(`\n共 ${findings.length} 处。预算表在 packages/tooling/scripts/src/ci/check-doc-budgets.ts。`)
  return 1
}
