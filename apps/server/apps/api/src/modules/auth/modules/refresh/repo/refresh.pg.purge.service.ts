import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'

import { WalnutPGConnectionName } from '@walnut-server/db'
import { LessThan, Repository } from 'typeorm'
import { AuthRefreshTokenEntity } from '../entity/refresh-token.entity'

/**
 * PG 版过期 refresh token 物理清理（phase2 第 6 节 Q10-b 定案的 Phase 3 交付物）。
 *
 * - 与 Mongo 侧的 `revokeExpiredRefreshTokenForCrobJob`（标记 revoked）并存且语义不同：
 *   本 job 对 PG 表做 **DELETE**，回收已过期行，走 `idx_rt_expired` 索引；
 * - 判据只用过期列 `expired_at < now()`：revoked 与否不代表可删（撤销行在过期前仍是
 *   审计证据），过期后统一物理回收；
 * - 频率取保守的每小时（清理是回收性质，晚跑一小时无业务影响）。
 */
@Injectable()
export class AuthRefreshTokenPgPurgeService {
  private readonly logger = new Logger(AuthRefreshTokenPgPurgeService.name)

  constructor(
    @InjectRepository(AuthRefreshTokenEntity, WalnutPGConnectionName)
    private readonly repository: Repository<AuthRefreshTokenEntity>,
  ) {}

  /**
   * @description DELETE FROM auth_refresh_token WHERE expired_at < now()
   */
  @Cron(CronExpression.EVERY_HOUR, { name: WalnutAdminConstAppCronTaskNames.AUTH_DELETE_REFRESH_PG_PURGE })
  async purgeExpiredRefreshTokens(): Promise<number> {
    const result = await this.repository.delete({ expiredAt: LessThan(new Date()) })

    const affected = result.affected ?? 0
    if (affected > 0) {
      this.logger.log(`[PgPurgeTaskLog] purged expired refresh tokens: ${affected}`)
    }

    return affected
  }
}
