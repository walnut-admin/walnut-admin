import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { WalnutAdminConstAppCronTaskNames } from '@walnut/const/app/task'
import { AppKeyService } from '@/modules/app/key/key.service'
import { AppKeyTypeConst } from '@/modules/app/key/schema/key.schema'

import { AppMonitorUserSharedService } from '@/modules/app/monitor/user/shared/user.shared.service'

import { AppSettingRepositoryService } from '@/modules/app/setting/repo/setting.repo.service'
import { AuthRefreshSharedService } from '@/modules/auth/modules/refresh/shared/refresh.shared.service'
import { SysLocaleSharedService } from '@/modules/system/locale/shared/locale.shared.service'
import { SysUserDeviceSharedService } from '@/modules/system/user_device/shared/user_device.shared.service'
import { SysUserMfaSharedService } from '@/modules/system/user_mfa/shared/user_mfa.shared.service'

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
  ) { }

  // extract app settings into cache
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: WalnutAdminConstAppCronTaskNames.APP_INIT_SETTINGS })
  async extractAppSetting() {
    this.logger.log('[CronTaskLog] App Setting.')
    const settingCount = await this.appSettingRepo.extractAppSettingIntoCache()
    this.logger.log(`[CronTaskLog] App Setting, app settings count : ${settingCount}`)
  }

  // extract locale messages into cache
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: WalnutAdminConstAppCronTaskNames.SYS_INIT_LOCALE_MESSAGES })
  async extractSysLocaleMessages() {
    this.logger.log('[CronTaskLog] Init System Locale.')
    const msgCount = await this.localeSharedService.extractLocaleMessagesIntoCacheForCronJob()
    this.logger.log(`[CronTaskLog] Init System Locale, locale message count : ${msgCount}`)
  }

  // delete expired refresh token
  @Cron(CronExpression.EVERY_2_HOURS, { name: WalnutAdminConstAppCronTaskNames.AUTH_DELETE_REFRESH })
  async deleteExpiredRefreshToken() {
    this.logger.log('[CronTaskLog] Revoke Expired Refresh Token.')
    const revoked = await this.authRefreshSharedService.revokeExpiredRefreshTokenForCrobJob()
    const expired = await this.appMonitorUserSharedService.updateAuthStateForCronJob(revoked)
    this.logger.log(`[CronTaskLog] Revoke Expired Refresh Token, expired refresh token count: ${revoked.length}`)
    this.logger.log(`[CronTaskLog] Monitor User Expired, expired monitor user count: ${expired.length}`)
  }

  // rotate app key
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: WalnutAdminConstAppCronTaskNames.APP_ROTATE_KEY })
  async rotateAppKey() {
    this.logger.log('[CronTaskLog] Rotate App Key.')
    await this.appKeyService.rotateForCronJob(AppKeyTypeConst.RSA_PAIR)
    await this.appKeyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL)
    this.logger.log('[CronTaskLog] Rotate App Key, done.')
  }

  // update device active status for cron jobs
  @Cron(CronExpression.EVERY_30_MINUTES, { name: WalnutAdminConstAppCronTaskNames.SYS_UPDATE_DEVICE_ACTIVE_STATUS })
  async updateDeviceActiveStatus() {
    this.logger.log('[CronTaskLog] Update Device Active Status.')
    const { matchedCount, modifiedCount, deletedCount } = await this.sysUserDeviceSharedService.updateDeviceActiveStatusForCronJob()
    this.logger.log(`[CronTaskLog] Update Device Active Status, matched count: ${matchedCount}, modified count: ${modifiedCount}, deleted count: ${deletedCount}`)
  }

  // update mfa device active status for cron jobs
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: WalnutAdminConstAppCronTaskNames.AUTH_MFA_SETUP })
  async updateMfaSetupStatus() {
    this.logger.log('[CronTaskLog] Update Mfa Setup Status.')
    const res = await this.sysUserMfaSharedService.updateMfaSetupStatusForCronJob()
    this.logger.log(`[CronTaskLog] Update Mfa Setup Status: ${JSON.stringify(res)}`)
  }
}
