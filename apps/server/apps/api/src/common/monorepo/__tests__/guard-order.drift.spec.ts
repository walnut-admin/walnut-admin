import { describe, expect, it } from 'vitest'

import { walkModuleGraph } from '../module-graph'

/**
 * G2 —— APP_GUARD 的 **12 元黄金序列**（拍板 D1：一条都不动）。
 *
 * 顺序真源不是 app.module.ts 一个文件，而是「**模块被扫描的顺序** × 模块内 providers 数组序」：
 * Scanner.insertProvider 在扫到某模块时把 enhancer 追加进 applicationProvidersApplyMap
 * （scanner.js:262-291），而模块扫描是**前序 DFS**（根模块先于 imports，scanner.js:44-95）。
 *
 * 所以第 12 位（Throttler）住在 tech.module.ts 里也照样排在 Lock 之后 —— 这正是 R1 的 C1：
 * 把 CAP 的两条单独挪进一个被 import 的模块，CAP 会掉到 JWT 之后，语义直接反转。
 * 本 spec 用**模块图走查**复算这个顺序，因此它拦得住「搬了但搬错位置」。
 *
 * 为什么静态解析而不是 import AppModule：见 module-graph.ts 头注释（求值期副作用）。
 */

const APP_MODULE_ENTRY = 'apps/api/src/app/app.module.ts'

/**
 * 黄金序列 —— 与 apps/server/AGENTS.md「Security Guard 执行顺序」一节逐字一致。
 * 注意 Risk 与 Cap 各出现**两次**（认证前 / 认证后各一个实例；Nest 每次注册生成独立
 * UUID token，见 scanner.js:273-296 —— 所以这不是笔误，也不许去重）。
 */
const GOLDEN_APP_GUARD_SEQUENCE = [
  'WalnutAdminGuardIP',
  'WalnutAdminGuardSecurity',
  'WalnutAdminGuardDevice',
  'WalnutAdminGuardRisk',
  'WalnutAdminGuardCap',
  'JwtAccessGuard',
  'WalnutAdminGuardRisk',
  'WalnutAdminGuardCap',
  'WalnutAdminGuardMFA',
  'WalnutAdminGuardSign',
  'WalnutAdminGuardLock',
  'WalnutAdminGuardThrottler',
]

const moduleGraph = walkModuleGraph(APP_MODULE_ENTRY)

/** 按模块扫描序把每条 APP_GUARD 摊平，并记住它来自哪个文件（失败时能直接定位） */
const flattenedGuards = moduleGraph.flatMap(node =>
  node.guardClasses.map(className => ({ className, file: node.file })),
)

describe('g2 · APP_GUARD 黄金序列（拍板 D1）', () => {
  it('模块图走查本身是有牙的（不是空图）', () => {
    expect(moduleGraph.length).toBeGreaterThan(20)
    expect(moduleGraph[0].className).toBe('AppModule')
    expect(flattenedGuards.length).toBeGreaterThan(0)
  })

  it('12 条 APP_GUARD 的 useClass 序列逐位等于黄金表', () => {
    expect(flattenedGuards.map(guard => guard.className)).toEqual(GOLDEN_APP_GUARD_SEQUENCE)
  })

  it('第 12 位 Throttler 来自 tech.module.ts —— 证明「顺序跨模块」这条 C1 前提仍成立', () => {
    const last = flattenedGuards[flattenedGuards.length - 1]
    expect(last.className).toBe('WalnutAdminGuardThrottler')
    expect(last.file).toBe('apps/api/src/modules/techniques/tech.module.ts')

    // 反证：只看 app.module.ts 一个文件只能数到 11 条，第 12 条必然漏
    const rootOnly = moduleGraph
      .filter(node => node.file === APP_MODULE_ENTRY)
      .flatMap(node => node.guardClasses)
    expect(rootOnly).toHaveLength(11)
    expect(rootOnly).not.toContain('WalnutAdminGuardThrottler')
  })

  it('顺序：CAP 的两条都在 JWT 前后各一（认证前 + 认证后）', () => {
    const capIndexes = flattenedGuards
      .map((guard, index) => (guard.className === 'WalnutAdminGuardCap' ? index : -1))
      .filter(index => index >= 0)
    const jwtIndex = flattenedGuards.findIndex(guard => guard.className === 'JwtAccessGuard')

    expect(capIndexes).toHaveLength(2)
    expect(capIndexes[0]).toBeLessThan(jwtIndex)
    expect(capIndexes[1]).toBeGreaterThan(jwtIndex)
  })
})
