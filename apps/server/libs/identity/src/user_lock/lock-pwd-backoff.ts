/**
 * 锁屏密码失败退避曲线（L1，2026-11-27）—— **唯一真源**（DB 只落计数与截止时间，不复制曲线）。
 *
 * 拍板 Q7：前 4 次失败只计次不封；**第 5 次起**进入退避，窗口
 * 30s → 1m → 2m → 5m → 15m → 30m 递增并封顶（第 10 次及以后恒 30 分钟）。
 *
 * 语义要点（与 `SysUserLockSharedService` 的调用点一起读）：
 * - 退避期内**一律拒绝**（与密码对错无关）—— 否则「错密码立刻回、退避中的对密码也要等」
 *   会退化成计时侧信道，攻击者可借响应时间判断密码是否已进入「第 N 次」；
 * - 退避截止后**保留** `fail_count`（不从 0 重来），下一次失败直接进下一档 ——
 *   成功解锁或管理员重置才清零；
 * - 计次只针对 security 模式的锁屏密码解锁与 fallback 登录口令验证；default/idle 的
 *   免密解锁不计数（没有可暴力猜的凭据）。
 */

/** 进入退避的失败次数阈值（第 5 次失败即封 30s） */
export const LOCK_PWD_FAIL_THRESHOLD = 5

/** 退避窗口（秒）：下标 0 对应第 5 次失败，之后逐档递增，超出取末位（封顶） */
export const LOCK_PWD_BACKOFF_SECONDS = [30, 60, 120, 300, 900, 1800] as const

/**
 * 按「累计连续失败次数」取本次退避秒数。
 *
 * @returns 进入退避时返回秒数；未达阈值（failCount < 5）返回 null（只计次、不封）
 */
export function getLockPwdBackoffSeconds(failCount: number): number | null {
  if (!Number.isFinite(failCount) || failCount < LOCK_PWD_FAIL_THRESHOLD) {
    return null
  }

  const index = Math.min(
    Math.floor(failCount) - LOCK_PWD_FAIL_THRESHOLD,
    LOCK_PWD_BACKOFF_SECONDS.length - 1,
  )

  return LOCK_PWD_BACKOFF_SECONDS[index]
}

/**
 * 退避剩余秒数（向上取整，最小 0）。
 *
 * @param lockedUntil 退避截止时间（Date / 毫秒时间戳 / null）
 * @param now 当前时间（毫秒时间戳，默认 Date.now() —— 纯函数测试可注入）
 */
export function getLockPwdRetryAfterSec(
  lockedUntil: Date | number | null | undefined,
  now: number = Date.now(),
): number {
  if (lockedUntil === null || lockedUntil === undefined) {
    return 0
  }

  const untilMs = lockedUntil instanceof Date ? lockedUntil.getTime() : lockedUntil

  if (!Number.isFinite(untilMs)) {
    return 0
  }

  return Math.max(0, Math.ceil((untilMs - now) / 1000))
}

/**
 * 是否仍在退避期内（strict：剩余 0 秒视为已过期）。
 */
export function isLockPwdBackoffActive(
  lockedUntil: Date | number | null | undefined,
  now: number = Date.now(),
): boolean {
  return getLockPwdRetryAfterSec(lockedUntil, now) > 0
}
