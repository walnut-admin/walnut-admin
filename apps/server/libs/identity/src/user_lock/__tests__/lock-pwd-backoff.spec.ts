import { describe, expect, it } from 'vitest'
import {
  getLockPwdBackoffSeconds,
  getLockPwdRetryAfterSec,
  isLockPwdBackoffActive,
  LOCK_PWD_BACKOFF_SECONDS,
  LOCK_PWD_FAIL_THRESHOLD,
} from '../lock-pwd-backoff'

/**
 * Q7 退避曲线（纯函数）：阈值 5、30s→1m→2m→5m→15m→30m 封顶。
 *
 * 这些数字同时是服务端行为的**唯一真源**（repo 的 `recordUnlockFailure` 只做原子计数，
 * 曲线只在这里）；api-spec 里的「第 5 次封 30s / 第 6 次 1m」读数直接由这里驱动。
 */
describe('lock pwd backoff curve', () => {
  it('阈值与曲线常量符合拍板 Q7', () => {
    expect(LOCK_PWD_FAIL_THRESHOLD).toBe(5)
    expect([...LOCK_PWD_BACKOFF_SECONDS]).toEqual([30, 60, 120, 300, 900, 1800])
  })

  it('前 4 次失败只计次不封（返回 null）', () => {
    expect(getLockPwdBackoffSeconds(0)).toBeNull()
    expect(getLockPwdBackoffSeconds(1)).toBeNull()
    expect(getLockPwdBackoffSeconds(4)).toBeNull()
  })

  it('第 5 次起按曲线递增，第 10 次及以后封顶 30 分钟', () => {
    expect(getLockPwdBackoffSeconds(5)).toBe(30)
    expect(getLockPwdBackoffSeconds(6)).toBe(60)
    expect(getLockPwdBackoffSeconds(7)).toBe(120)
    expect(getLockPwdBackoffSeconds(8)).toBe(300)
    expect(getLockPwdBackoffSeconds(9)).toBe(900)
    expect(getLockPwdBackoffSeconds(10)).toBe(1800)
    expect(getLockPwdBackoffSeconds(11)).toBe(1800)
    expect(getLockPwdBackoffSeconds(10_000)).toBe(1800)
  })

  it('非法 count（NaN / Infinity / 负数）不进入退避', () => {
    expect(getLockPwdBackoffSeconds(Number.NaN)).toBeNull()
    expect(getLockPwdBackoffSeconds(Number.POSITIVE_INFINITY)).toBeNull()
    expect(getLockPwdBackoffSeconds(-3)).toBeNull()
  })

  it('retryAfterSec：向上取整、过期/缺失为 0', () => {
    const now = 1_700_000_000_000

    expect(getLockPwdRetryAfterSec(null, now)).toBe(0)
    expect(getLockPwdRetryAfterSec(undefined, now)).toBe(0)
    expect(getLockPwdRetryAfterSec(new Date(now - 1000), now)).toBe(0)
    expect(getLockPwdRetryAfterSec(new Date(now + 30_000), now)).toBe(30)
    // 29999ms → 30s（ceil）
    expect(getLockPwdRetryAfterSec(now + 29_999, now)).toBe(30)
    expect(getLockPwdRetryAfterSec(new Date(now + 1_000), now)).toBe(1)
    // 剩余不足 1 秒也按 1 秒算（避免「显示 0 秒但还在封」）
    expect(getLockPwdRetryAfterSec(new Date(now + 1), now)).toBe(1)
  })

  it('isLockPwdBackoffActive 与剩余秒数同源', () => {
    const now = 1_700_000_000_000
    expect(isLockPwdBackoffActive(null, now)).toBe(false)
    expect(isLockPwdBackoffActive(new Date(now - 1), now)).toBe(false)
    expect(isLockPwdBackoffActive(new Date(now + 1), now)).toBe(true)
  })
})
