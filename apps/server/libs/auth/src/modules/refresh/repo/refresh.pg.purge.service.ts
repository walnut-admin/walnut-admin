import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { AppTechCacheCronLockService } from '@walnut-server/cache'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'

import { WalnutPGConnectionName } from '@walnut-server/db'
import { LessThan, Repository } from 'typeorm'
import { AuthRefreshTokenEntity } from '../entity/refresh-token.entity'

/**
 * PG 版过期 refresh token 物理清理（phase2 第 6 节 Q10-b 定案的 Phase 3 交付物）。
 *
 * - 与 `revokeExpiredRefreshTokenForCronJob`（标记 revoked）并存且语义不同：
 *   本 job 对 PG 表做 **DELETE**，回收已过期行，走 `idx_rt_expired` 索引；
 * - 判据只用过期列 `expired_at < now()`：revoked 与否不代表可删（撤销行在过期前仍是
 *   审计证据），过期后统一物理回收；
 * - 频率取保守的每小时（清理是回收性质，晚跑一小时无业务影响）。
 */
@Injectable()
export class AuthRefreshTokenPgPurgeService {
  private readonly logger = new Logger(AuthRefreshTokenPgPurgeService.name)

  constructor(
    // 数据权限：auth_refresh_token 在注册表豁免清单（登录会话系统表）；
    // 本 job 是纯系统任务（cron，无请求用户），按过期列物理回收。
    @InjectRepository(AuthRefreshTokenEntity, WalnutPGConnectionName)
    private readonly repository: Repository<AuthRefreshTokenEntity>,
    // W2-A：cron 单实例 try-lock（AppTechCacheModule @Global，见 cache.cron-lock.ts）
    private readonly cronLock: AppTechCacheCronLockService,
  ) {}

  /**
   * @description DELETE FROM auth_refresh_token WHERE expired_at < now()
   *
   * W2-A：多进程（api + worker / 多副本）时同一 tick 只允许一个实例执行；
   * `waitForCompletion` 防同实例上一次未跑完时自重叠。任务体**整体**在 `runExclusive`
   * 回调里 —— 拿不到锁时不会执行任何删除（也不再提供 `useLock` 布尔开关，避免误用）。
   *
   * @returns 删除行数；`null` = 本次 tick 未拿到锁（另一实例在执行），与「没有过期行
   *   （返回 0）」区分。
   */
  @Cron(CronExpression.EVERY_HOUR, { name: WalnutAdminConstAppCronTaskNames.AUTH_DELETE_REFRESH_PG_PURGE, waitForCompletion: true })
  async purgeExpiredRefreshTokens(): Promise<number | null> {
    const purged = await this.cronLock.runExclusive('purgeExpiredRefreshTokens', 300, async () => this.doPurgeExpiredRefreshTokens())

    // runExclusive 的 undefined = 未拿到锁、本次 tick 被跳过（任务体未执行）；
    // 用 null 表达「本次没跑」，不伪装成「删了 0 行」
    return purged ?? null
  }

  /** 纯任务体（无锁）：只在 @Cron 入口的持锁回调里执行 */
  private async doPurgeExpiredRefreshTokens(): Promise<number> {
    const result = await this.repository.delete({ expiredAt: LessThan(new Date()) })

    const affected = result.affected ?? 0
    if (affected > 0) {
      this.logger.log(`[PgPurgeTaskLog] purged expired refresh tokens: ${affected}`)
    }

    return affected
  }
}
