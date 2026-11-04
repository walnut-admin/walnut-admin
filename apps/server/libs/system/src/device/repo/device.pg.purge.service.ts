import type { IIdentityMonitorRepository } from '@walnut-server/identity'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectDataSource } from '@nestjs/typeorm'
import { AppTechCacheCronLockService, AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'
import { runInWalnutSystemTransaction, WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY } from '@walnut-server/identity'
import { DataSource } from 'typeorm'
import { SysDeviceRepositoryService } from './device.repo.service'

/** 留存窗口：90 天没有任何写活动即可回收（判据见 device.repo.service.purgeInactiveDevicesBefore） */
const DEVICE_RETENTION_DAYS = 90

/**
 * 90 天设备留存清理（批次 11 · B5 收尾）。
 *
 * 为什么是**独立** cron，而不是挂进 `updateDeviceActiveStatus`：
 * 那个任务体整体被 `isDev` 门住（user_device.shared.service.ts 一进来就 return 0），
 * 把物理删除挂进去等于「dev 永远测不到、生产每 30 分钟删一次」—— 语义和频率都不对。
 * 形状照 `refresh.pg.purge.service.ts`（独立服务 + @Cron + cronLock + 「没拿到锁返 null，
 * 不伪装成删了 0 行」）。
 *
 * 为什么**不放在** api 启动预热（bootstrap-task）：那是每次启动都跑一遍的薄缓存任务，
 * 物理删除不该由「进程起来了几次」决定。
 *
 * 归属与其余 cron 一致：`WORKER_STANDALONE=true` 时由 worker 进程跑（schedule.composition），
 * 无需额外开关。
 */
@Injectable()
export class SysDevicePgPurgeService {
  private readonly logger = new Logger(SysDevicePgPurgeService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,

    private readonly deviceRepoService: SysDeviceRepositoryService,

    // app_monitor_user 在 RLS 表清单里（FORCE ROW LEVEL SECURITY）：cron 没有请求用户，
    // 直连池级 manager 的 DELETE 会被策略过滤成 affected=0（**静默不删**），必须走 system
    // 通道。这里注入端口而非具体仓库：libs/system 不能反向依赖 libs/app-domain。
    @Inject(WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY)
    private readonly monitorRepository: IIdentityMonitorRepository,

    // W2-A：cron 单实例 try-lock（AppTechCacheModule @Global）
    private readonly cronLock: AppTechCacheCronLockService,

    // 90 天留存必须在**提交后**失效 SYSTEM:DEVICE:<deviceId>：否则被删设备只要缓存
    // 还在就继续放行（device.guard.ts 的「库里没有行 ⇒ 40605」要等 Redis 淘汰/重启
    // 才走得到），留存策略在缓存层等于没生效。
    private readonly cacheDeviceService: AppTechCacheDeviceService,
  ) {}

  /**
   * @description 删掉「不在用且 90 天无写活动」的设备行，连带清掉它们的 monitor 行与设备缓存
   *
   * 频率取每天 03:00（避开 00:00 校钥 / 01:00 MFA / 02:00 settings+locale 的整点任务）。
   * 任务体**整体**在 `runExclusive` 回调里 —— 拿不到锁时不会执行任何删除。
   *
   * @returns 删除的设备行数；`null` = 本次 tick 未拿到锁（另一实例在执行），与
   *   「没有过期行（返回 0）」区分。
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: WalnutAdminConstAppCronTaskNames.SYS_DEVICE_RETENTION_PURGE, waitForCompletion: true })
  async purgeInactiveDevices(): Promise<number | null> {
    const purged = await this.cronLock.runExclusive('purgeInactiveDevices', 600, async () => this.doPurgeInactiveDevices())

    // runExclusive 的 undefined = 未拿到锁、本次 tick 被跳过（任务体未执行）；
    // 用 null 表达「本次没跑」，不伪装成「删了 0 行」
    return purged ?? null
  }

  /** 纯任务体（无锁）：只在 @Cron 入口的持锁回调里执行 */
  private async doPurgeInactiveDevices(): Promise<number> {
    const cutoff = new Date(Date.now() - DEVICE_RETENTION_DAYS * 24 * 60 * 60 * 1000)

    // 事务里只做「删行」：返回被删的 device_id 与连带清掉的 monitor 行数，
    // 缓存失效放到事务**提交之后**（③）。
    const { deviceIds, monitorRows } = await runInWalnutSystemTransaction(this.dataSource, async (manager) => {
      // ① 选目标并删除（全部谓词都在 SQL 里 ⇒ 重复执行天然幂等，第二次必 0 行）
      const ids = await this.deviceRepoService.purgeInactiveDevicesBefore(cutoff, manager)

      if (ids.length === 0) {
        return { deviceIds: ids, monitorRows: 0 }
      }

      // ② **同一事务**清 monitor 行：app_monitor_user 没有 FK 到 sys_device（松引用）且
      // visitor_id 全局唯一 —— 留成孤儿会让同指纹的下一次首行登记撞 uq_monitor_visitor
      // （23505 → 40000），那台设备心跳永久坏。
      const rows = await this.monitorRepository.deleteByDeviceIds(ids, manager)

      return { deviceIds: ids, monitorRows: rows }
    })

    if (deviceIds.length === 0) {
      return 0
    }

    // ③ **提交后**失效 SYSTEM:DEVICE:<deviceId>，一处删除对应一处失效。
    //
    // 为什么不在 ② 里（事务内）删：DB 删除在提交前对其他连接不可见，此时缓存已空 ⇒
    // 并发的 guard 请求会 miss 回源、读到**尚未删除**的行，把缓存重新灌成「放行」。
    // 提交后再删，后续回源只会读到「没有行」⇒ 40605（device.guard.ts:115-121）。
    // 也不能用 runAfterCommit 代替：本任务的事务来自 runInWalnutSystemTransaction
    // （withQueryRunnerTransaction），它不建 DBTransactionHooksStore，钩子会退化成
    // 「立即执行」—— 又回到提交前删缓存那条错路。
    const failed = await this.invalidateDeviceCaches(deviceIds)

    this.logger.log(
      `[PgPurgeTaskLog] purged inactive devices: ${deviceIds.length} (monitor rows: ${monitorRows}; `
      + `device cache invalidated: ${deviceIds.length - failed.length}/${deviceIds.length}; `
      + 'sys_user_device / auth_refresh_token 按 fk_* ON DELETE CASCADE 一并清除)',
    )

    return deviceIds.length
  }

  /**
   * @description 批量失效 `SYSTEM:DEVICE:<deviceId>`（只在事务**提交之后**调用）
   *
   * 失败处理：DB 删除已经提交，Redis 抖动不能让删除回滚、也不该把本次 tick 变成失败
   * （返回值是「删了几行」这个事实）。但失败**不能静默** —— 每个失败的键一条 error，
   * 外加一条带计数的聚合 error：留着的那把缓存键 = 该设备仍会被 device guard 放行。
   *
   * 逐键删除而不是全量并发：一次留存清理的量级是每天一次、可控，单键删除的失败定位
   * 比 Promise.allSettled 的批量更容易落到具体 deviceId。
   *
   * @returns 失效失败的 deviceId（调用方只记日志/计数：不回滚、不重试）
   */
  private async invalidateDeviceCaches(deviceIds: string[]): Promise<string[]> {
    const failed: string[] = []

    for (const deviceId of deviceIds) {
      try {
        await this.cacheDeviceService.delSysDeviceCache(deviceId)
      }
      catch (e) {
        failed.push(deviceId)
        this.logger.error(
          `[PgPurgeCacheInvalidationError] failed to invalidate SYSTEM:DEVICE:${deviceId}`,
          e instanceof Error ? e.stack : String(e),
        )
      }
    }

    if (failed.length > 0) {
      this.logger.error(
        `[PgPurgeCacheInvalidation] ${failed.length}/${deviceIds.length} device cache keys survived purge — `
        + 'those devices keep passing the device guard until Redis evicts them',
      )
    }

    return failed
  }
}
