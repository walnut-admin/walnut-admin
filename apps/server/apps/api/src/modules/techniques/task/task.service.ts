import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AppKeyService, AppKeyTypeConst, AppSettingRepositoryService } from '@walnut-server/app-domain'
import { AuthRefreshSharedService } from '@walnut-server/auth'
import { AppTechCacheCronLockService } from '@walnut-server/cache'

import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'

import { SysUserDeviceSharedService, SysUserMfaSharedService } from '@walnut-server/identity'
import { SysLocaleSharedService } from '@walnut-server/system'
import { AppMonitorUserSharedService } from '@/modules/app/monitor/user/shared/user.shared.service'

/**
 * 六个 cron 任务的实现（W2-A：@Cron 入口一律经 `AppTechCacheCronLockService` 做
 * Redis 单实例 try-lock + `waitForCompletion` 防同实例自重叠）。
 *
 * 结构（W2-A 修复批，2026-11-01）：每个任务拆成三层 ——
 * - `private doXxx()`：纯任务体（无锁），只由下面两个入口调用；
 * - `async xxx()`：`@Cron` 入口，任务体**整体**在 `runExclusive` 回调里执行 ——
 *   拿不到锁时任务体根本不会跑；回调返回值即本次执行结果（`undefined` = 跳过本 tick）；
 * - `async runBootstrapXxx()`：bootstrap 显式无锁入口（归属由 `AppBootstrapTaskModule`
 *   的组合根保证单份，不占 Redis 锁）。用独立方法而不是布尔参数，避免「忘记传/传错」
 *   让 @Cron 入口误走无锁路径。
 *
 * 原实现 `await runExclusive(..., () => this.xxx(false))` 之后继续在锁外裸跑任务体，
 * 每个 tick 双跑；拆层后任务体有且仅有一个调用点。
 */
@Injectable()
export class AppTechTasksService {
  private readonly logger = new Logger(AppTechTasksService.name)

  constructor(
    private readonly appSettingRepo: AppSettingRepositoryService,
    private readonly localeSharedService: SysLocaleSharedService,
    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly appKeyService: AppKeyService,
    private readonly sysUserDeviceSharedService: SysUserDeviceSharedService,
    private readonly appMonitorUserSharedService: AppMonitorUserSharedService,
    private readonly sysUserMfaSharedService: SysUserMfaSharedService,
    private readonly cronLock: AppTechCacheCronLockService,
  ) { }

  /**
   * extract app settings into cache
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: WalnutAdminConstAppCronTaskNames.APP_INIT_SETTINGS, waitForCompletion: true })
  async extractAppSetting() {
    return this.cronLock.runExclusive('extractAppSetting', 600, async () => this.doExtractAppSetting())
  }

  /** bootstrap 无锁入口（见类注释；归属由组合根保证单份） */
  async runBootstrapExtractAppSetting() {
    return this.doExtractAppSetting()
  }

  private async doExtractAppSetting() {
    this.logger.log('[CronTaskLog] App Setting.')
    const settingCount = await this.appSettingRepo.extractAppSettingIntoCache()
    this.logger.log(`[CronTaskLog] App Setting, app settings count : ${settingCount}`)
  }

  /**
   * extract locale messages into cache
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: WalnutAdminConstAppCronTaskNames.SYS_INIT_LOCALE_MESSAGES, waitForCompletion: true })
  async extractSysLocaleMessages() {
    return this.cronLock.runExclusive('extractSysLocaleMessages', 600, async () => this.doExtractSysLocaleMessages())
  }

  /** bootstrap 无锁入口（见类注释） */
  async runBootstrapExtractSysLocaleMessages() {
    return this.doExtractSysLocaleMessages()
  }

  private async doExtractSysLocaleMessages() {
    this.logger.log('[CronTaskLog] Init System Locale.')
    const msgCount = await this.localeSharedService.extractLocaleMessagesIntoCacheForCronJob()
    this.logger.log(`[CronTaskLog] Init System Locale, locale message count : ${msgCount}`)
  }

  /**
   * delete expired refresh token
   *
   * 任务最长，TTL 给 900s。
   */
  @Cron(CronExpression.EVERY_2_HOURS, { name: WalnutAdminConstAppCronTaskNames.AUTH_DELETE_REFRESH, waitForCompletion: true })
  async deleteExpiredRefreshToken() {
    return this.cronLock.runExclusive('deleteExpiredRefreshToken', 900, async () => this.doDeleteExpiredRefreshToken())
  }

  /** bootstrap 无锁入口（见类注释） */
  async runBootstrapDeleteExpiredRefreshToken() {
    return this.doDeleteExpiredRefreshToken()
  }

  private async doDeleteExpiredRefreshToken() {
    this.logger.log('[CronTaskLog] Revoke Expired Refresh Token.')
    const revoked = await this.authRefreshSharedService.revokeExpiredRefreshTokenForCronJob()
    const expired = await this.appMonitorUserSharedService.updateAuthStateForCronJob(revoked)
    this.logger.log(`[CronTaskLog] Revoke Expired Refresh Token, expired refresh token count: ${revoked.length}`)
    this.logger.log(`[CronTaskLog] Monitor User Expired, expired monitor user count: ${expired.length}`)
  }

  /**
   * rotate app key
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: WalnutAdminConstAppCronTaskNames.APP_ROTATE_KEY, waitForCompletion: true })
  async rotateAppKey() {
    return this.cronLock.runExclusive('rotateAppKey', 300, async () => this.doRotateAppKey())
  }

  /** bootstrap 无锁入口（见类注释） */
  async runBootstrapRotateAppKey() {
    return this.doRotateAppKey()
  }

  private async doRotateAppKey() {
    this.logger.log('[CronTaskLog] Rotate App Key.')
    await this.appKeyService.rotateForCronJob(AppKeyTypeConst.RSA_PAIR)
    await this.appKeyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL)
    this.logger.log('[CronTaskLog] Rotate App Key, done.')
  }

  /**
   * update device active status for cron jobs
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: WalnutAdminConstAppCronTaskNames.SYS_UPDATE_DEVICE_ACTIVE_STATUS, waitForCompletion: true })
  async updateDeviceActiveStatus() {
    return this.cronLock.runExclusive('updateDeviceActiveStatus', 300, async () => this.doUpdateDeviceActiveStatus())
  }

  /** bootstrap 无锁入口（见类注释） */
  async runBootstrapUpdateDeviceActiveStatus() {
    return this.doUpdateDeviceActiveStatus()
  }

  private async doUpdateDeviceActiveStatus() {
    this.logger.log('[CronTaskLog] Update Device Active Status.')
    const { matchedCount, modifiedCount, deletedCount } = await this.sysUserDeviceSharedService.updateDeviceActiveStatusForCronJob()
    this.logger.log(`[CronTaskLog] Update Device Active Status, matched count: ${matchedCount}, modified count: ${modifiedCount}, deleted count: ${deletedCount}`)
  }

  /**
   * update mfa device active status for cron jobs
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: WalnutAdminConstAppCronTaskNames.AUTH_MFA_SETUP, waitForCompletion: true })
  async updateMfaSetupStatus() {
    return this.cronLock.runExclusive('updateMfaSetupStatus', 300, async () => this.doUpdateMfaSetupStatus())
  }

  /** bootstrap 无锁入口（见类注释） */
  async runBootstrapUpdateMfaSetupStatus() {
    return this.doUpdateMfaSetupStatus()
  }

  private async doUpdateMfaSetupStatus() {
    this.logger.log('[CronTaskLog] Update Mfa Setup Status.')
    const res = await this.sysUserMfaSharedService.updateMfaSetupStatusForCronJob()
    this.logger.log(`[CronTaskLog] Update Mfa Setup Status: ${JSON.stringify(res)}`)
  }
}
