/**
 * 等待链路的**总预算**（P2-1）：从链路起点计时，单步 timeout 只是子预算。
 *
 * 为什么需要它：`loginViaUI` 的每一步都有自己的超时（打开页面 30s、CAP 60s、MFA 20s、
 * 落地 40s……），单独看都「合理」，叠起来却可以超过用例的全局 120s —— 那时报错是
 * Playwright 的通用 `Test timeout of 120000ms exceeded`，既看不出卡在哪一步，也拿不到
 * 失败现场（用例作用域的 fixture 还在收尾）。总预算让链路**在全局超时之前**以带上下文的
 * 方式红掉；全局 120s 只作兜底，慢用例（`test.slow()`）仍按需加宽，这里不碰。
 *
 * 纯函数：不读时钟之外的状态，单测直接喂 `now`。
 */
export interface WaitBudget {
  totalMs: number
  startedAt: number
}

/** 从 `now`（默认当前时刻）开始计一条链路的预算 */
export function startWaitBudget(totalMs: number, now: number = Date.now()): WaitBudget {
  return { totalMs, startedAt: now }
}

/** 剩余预算（可能为负：调用方用 {@link budgetStep} 判定耗尽） */
export function remainingBudget(budget: WaitBudget, now: number = Date.now()): number {
  return budget.totalMs - (now - budget.startedAt)
}

/**
 * 取一步的超时：`min(该步上限, 剩余预算)`；剩余 ≤ 0 时抛错并点名**即将开始的步骤**。
 *
 * 返回值至少 1ms（Playwright 不接受 0 以外的语义：0 表示「无超时」，会把链路挂死）。
 */
export function budgetStep(
  budget: WaitBudget,
  step: string,
  capMs: number,
  now: number = Date.now(),
): number {
  const remaining = remainingBudget(budget, now)
  if (remaining <= 0) {
    throw new Error(
      `[e2e/wait-budget] 已用完 ${Math.round(budget.totalMs / 1000)}s 总预算（在「${step}」之前）；` +
        '单步超时不再单独计时 —— 现场由外层（loginViaUI）补齐',
    )
  }
  return Math.max(1, Math.min(capMs, remaining))
}
