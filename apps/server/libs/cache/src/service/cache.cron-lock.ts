import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppTechCacheService } from '../cache.service'

/**
 * 抢锁等待上限（毫秒）。
 *
 * node-redis 在断连重连期间把命令放进 offline queue：`SET NX` 既不 resolve 也不 reject，
 * 任务会**永远卡在抢锁**（`waitForCompletion` 还会挡住后续 tick）。1s 远大于正常 RTT、
 * 又远小于任何任务的执行周期；超时按「锁状态未知」处理（见 `runExclusive`）。
 */
export const CRON_LOCK_ACQUIRE_TIMEOUT_MS = 1000

/** 抢锁超时（区别于 Redis 命令报错）：用于在 fail-open 的两条路径里分别记日志 */
class CronLockAcquireTimeoutError extends Error {
  constructor(taskName: string, timeoutMs: number) {
    super(`[CronLock] acquire "${taskName}" timed out after ${timeoutMs}ms`)
    this.name = 'CronLockAcquireTimeoutError'
  }
}

/**
 * cron 单实例执行锁（W2-A，2026-11-01；修复批 2026-11-01 补抢锁超时兜底）。
 *
 * `@Cron` 是进程内定时器：多进程（api + worker 同时起、或多副本）时同一 tick 会在每个
 * 进程各跑一遍。这里用 Redis `SET NX EX` 做**非阻塞**的 try-lock —— 拿不到锁的实例只
 * 记一条 warn 后跳过本次 tick，不排队、不报错（cron 的下一次 tick 会再抢）。
 *
 * 语义要点：
 * - **fail-open（三条路径，前两条执行、第三条跳过）**：
 *   ① **Redis 命令异常**（连接失败等）：warn 后**无锁执行**；
 *   ② **抢锁超时**（offline queue 挂起 `SET NX`）：warn 后**无锁执行**，并标记本次为
 *      **abandoned** —— 锁状态未知，结束时**不释放**：释放命令自身也会挂在同一个
 *      offline queue 上不 settle（runExclusive 不能因释放卡住而阻塞下一个 tick），
 *      且我们可能根本没拿到锁；若命令其实最终成功，锁随 TTL 自然过期；
 *   ③ **正常未拿到锁**（键已被另一实例持有）：warn 后**跳过本次 tick**，任务体不执行。
 *   理由是任务本身按 upsert / 条件判断做到幂等，锁只是「减少重复执行」的优化；若
 *   fail-closed，Redis 故障会让所有清理/预热任务静默停摆，运维代价远大于重复执行一遍。
 * - **TTL 兜底**：持锁进程崩溃时不会被永久占锁；TTL 按任务最长耗时给 300-900s。
 * - **原子释放**：只删自己写入的锁（进程内 UUID token）——释放走 `deleteIfValue`
 *   （Lua EVAL 在 Redis 内一次完成「读 → 比对 `v` → DEL」），不再是 GET→比对→DEL
 *   两步：两步之间 TTL 到期、键被别的实例重新持有时会误删对方的锁（修复批
 *   2026-11-01）。
 * - 锁键经 `AppTechCacheService` 自动带 `WALNUT_CACHE_` 前缀，形如
 *   `WALNUT_CACHE_CRON_LOCK:<taskName>`，随 TTL 自然清理。
 *
 * 只用于 `@Cron` 入口；bootstrap（`AppBootstrapTaskModule`）的归属由组合根保证单份，
 * 不经过本锁。
 */
@Injectable()
export class AppTechCacheCronLockService {
  private readonly logger = new Logger(AppTechCacheCronLockService.name)

  constructor(private readonly cache: AppTechCacheService) {}

  /**
   * @param taskName 任务名（= @Cron 方法名），锁键 `CRON_LOCK:<taskName>`
   * @param ttlSeconds 锁的 TTL（秒），必须大于任务最长耗时
   * @param fn 任务体
   * @returns 任务体返回值。`undefined` = **明确的跳过**（锁被另一实例持有，任务体未执行）；
   *   Redis 异常 / 抢锁超时（fail-open）时任务体照常执行，返回其实际结果 —— 因此只有
   *   回调返回**非 void** 时，`undefined` 才能与「任务体的结果」区分开（回调返回 void
   *   的入口不依赖这个返回值判断是否执行）。
   */
  async runExclusive<T>(taskName: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined> {
    const key = `CRON_LOCK:${taskName}`
    const token = randomUUID()

    const outcome = await this.tryAcquire(key, token, ttlSeconds, taskName)

    if (outcome === 'occupied') {
      this.logger.warn(`[CronLock] "${taskName}" is already running on another instance, skip this tick`)
      return undefined
    }

    // outcome === 'unknown'（Redis 异常 / 抢锁超时）：fail-open 无锁执行。
    // 锁状态未知 → abandoned：finally 不释放（可能是别人的锁，也可能稍后自己拿到而随 TTL 过期）。
    const abandoned = outcome === 'unknown'

    try {
      return await fn()
    }
    finally {
      if (!abandoned) {
        await this.releaseWithTimeout(key, token, taskName)
      }
    }
  }

  /**
   * 抢锁，归一出三种结果：
   * - `acquired`：拿到锁，调用方负责释放；
   * - `occupied`：键被另一实例持有（明确的 false），调用方跳过本次 tick；
   * - `unknown`：命令异常或超时，锁状态未知，调用方 fail-open 且不释放。
   */
  private async tryAcquire(
    key: string,
    token: string,
    ttlSeconds: number,
    taskName: string,
  ): Promise<'acquired' | 'occupied' | 'unknown'> {
    let timer: NodeJS.Timeout | undefined

    try {
      // 超时不是取消 setIfAbsent：命令可能稍后仍在 offline queue 里落地（拿到锁），
      // 所以超时结果只能当「状态未知」，不能当「没拿到」。race 已挂接它的 settle，
      // 晚到的结果/异常不会变成 unhandled rejection。
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CronLockAcquireTimeoutError(taskName, CRON_LOCK_ACQUIRE_TIMEOUT_MS)),
          CRON_LOCK_ACQUIRE_TIMEOUT_MS,
        )
      })

      const acquired = await Promise.race([
        this.cache.setIfAbsent(key, token, { ttl: ttlSeconds, t: WalnutAdminConstAppCacheType.BUILT_IN }),
        timeout,
      ])

      return acquired ? 'acquired' : 'occupied'
    }
    catch (e) {
      if (e instanceof CronLockAcquireTimeoutError) {
        // fail-open ②：锁状态未知（Redis 可能只是断连重连中，命令仍挂在 offline queue）
        this.logger.warn(
          `[CronLock] acquire timed out after ${CRON_LOCK_ACQUIRE_TIMEOUT_MS}ms for "${taskName}" (lock state unknown), run without lock`,
        )
        return 'unknown'
      }

      // fail-open ①：Redis 命令异常（见类注释）。Redis 故障不应让清理/预热任务停摆。
      this.logger.warn(`[CronLock] acquire failed for "${taskName}", run without lock`, e)
      return 'unknown'
    }
    finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  /**
   * 带超时的释放：Redis 断连重连期间 EVAL 会挂在 offline queue 上不 settle——
   * runExclusive 的调用方（waitForCompletion 的 cron）不能因释放卡住而跳过后续 tick。
   * 超时后放弃等待（不抛错），锁随 TTL 自然过期。
   */
  private async releaseWithTimeout(key: string, token: string, taskName: string): Promise<void> {
    await Promise.race([
      this.release(key, token, taskName),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        timer.unref?.()
      }),
    ])
  }

  private async release(key: string, token: string, taskName: string): Promise<void> {
    try {
      // 原子比对删除：只有键仍是自己写入的 token 时才删（TTL 到期被他人重持 → false）
      const released = await this.cache.deleteIfValue(key, token)

      if (!released) {
        // 键已过期（TTL 兜底）或被别的实例重新持有：都不能再动它
        this.logger.warn(`[CronLock] "${taskName}" lock token mismatch or expired, skip release`)
      }
    }
    catch (e) {
      // 释放失败不阻断任务完成；锁随 TTL 自然过期
      this.logger.warn(`[CronLock] release failed for "${taskName}", wait for TTL`, e)
    }
  }
}
