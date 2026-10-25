import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { AuthMfaStatusDTO } from '@/modules/auth/modules/mfa/mfa.dto'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { SysUserRepositoryService } from '../../user/repo/user.repo.service'
import { SysUserMfaRepositoryService } from '../repo/user_mfa.repo.service'

/**
 * B7b 迁移：mfa 表读写腿已迁 PG —— 事务句柄 `dbSession: ClientSession` →
 * `em?: EntityManager`（缺省连接级 manager，cron 等非请求路径不传即走）。
 */
@Injectable()
export class SysUserMfaSharedService {
  private readonly logger = new Logger(SysUserMfaSharedService.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly sysUserMfaRepoService: SysUserMfaRepositoryService,
  ) { }

  async getUserMfaTotalStatus(userId: string, em?: EntityManager) {
    const result = {
      totp: {
        status: false,
        verified: false,
      },
      webauthn: {
        status: false,
        verified: false,
      },
    }

    // totp: if find, then it's verified true, status depends on record status
    const totpRecords = await this.sysUserMfaRepoService.findTotpByUserId(userId, em)

    if (totpRecords) {
      result.totp.status = totpRecords.status
      result.totp.verified = true
    }

    // webauthn: if find, then it's true, more detail is in later modal table
    // what we return below is just a total status, not detailed
    const webauthnRecords = await this.sysUserMfaRepoService.findWebauthnByUserId(userId, em)

    if (webauthnRecords) {
      result.webauthn.status = true
      result.webauthn.verified = true
    }

    return result
  }

  /**
   * @description check if current user MFA is verified
   */
  async getIsCurrentUserMfaVerified(userId: string, deviceId: string, em?: EntityManager) {
    const mfaConfig = await this.cacheAppSettingsService.getAuthMfaConfig()
    const requiredCount = mfaConfig.methodsRequiredCount

    const results = await this.getCurrentUserMfaSetupStatus(userId, deviceId, em)
    const enabledCount = results.filter(record => record.enabled).length

    return enabledCount >= requiredCount
  }

  /**
   * @description used for when mfa-required, get current user MFA verified status
   */
  async getCurrentUserMfaSetupStatus(userId: string, deviceId: string, em?: EntityManager) {
    const result: AuthMfaStatusDTO[] = [
      {
        type: 'totp',
        enabled: false,
      },
      {
        type: 'webauthn',
        enabled: false,
      },
    ]

    const totpRecords = await this.sysUserMfaRepoService.findActiveTotpByUserId(userId, em)

    if (totpRecords) {
      result[0].enabled = true
    }

    const webauthnRecords = await this.sysUserMfaRepoService.findWebauthnByUserIdAndDeviceId(userId, deviceId, em)

    if (webauthnRecords) {
      result[1].enabled = true
    }

    return result
  }

  /**
   * Cron job: Synchronize MFA verification status for all users
   * Scenarios:
   * 1. Admin modified MFA config (e.g., requiredCount)
   * 2. User deleted MFA device but status was not updated in time
   * 3. Data consistency guarantee
   *
   * （B7b 归一：aggregate 与 user 读写同为 PG —— B7a 的跨引擎注释随之失效，
   * userId 两侧同为 uuid 直接比对）
   */
  async updateMfaSetupStatusForCronJob() {
    const startTime = Date.now()
    this.logger.log('Starting MFA status synchronization cron job')

    try {
      // 1. Get MFA configuration
      const mfaConfig = await this.cacheAppSettingsService.getAuthMfaConfig()
      const requiredCount = mfaConfig.methodsRequiredCount

      // 2. Aggregate and count MFA devices per user
      const userMfaStats = await this.sysUserMfaRepoService.aggregateMfaStats()

      this.logger.log(`Found ${userMfaStats.length} users with MFA devices`)

      // 3. Update users with MFA devices
      let verifiedCount = 0
      let unverifiedCount = 0

      for (const stat of userMfaStats) {
        const shouldBeVerified = stat.deviceCount >= requiredCount

        await this.sysUserRepoService.findUserByIdAndUpdate(
          stat.userId,
          { mfaSetup: shouldBeVerified },
        )

        if (shouldBeVerified) {
          verifiedCount++
        }
        else {
          unverifiedCount++
        }
      }

      // 4. Handle users without MFA devices (set to unverified)
      // Get all user IDs that currently have mfaSetup=true but should be false
      const userIdsWithMfa = userMfaStats.map(s => s.userId)

      // Find users without MFA devices but marked as verified
      const allUsersWithMfaSetup = await this.sysUserRepoService.findAllUsers()
      const usersToReset = allUsersWithMfaSetup.filter(
        user => user.mfaSetup === true && !userIdsWithMfa.includes(user.id),
      )

      // Reset each user individually
      for (const user of usersToReset) {
        await this.sysUserRepoService.findUserByIdAndUpdate(
          user.id,
          { mfaSetup: false },
        )
      }

      this.logger.log(`Reset ${usersToReset.length} users without MFA devices to unverified`)

      const duration = Date.now() - startTime
      this.logger.log(
        `MFA status synchronization completed - `
        + `Verified: ${verifiedCount}, Unverified: ${unverifiedCount}, `
        + `Duration: ${duration}ms`,
      )

      return {
        success: true,
        verifiedCount,
        unverifiedCount,
        totalProcessed: userMfaStats.length,
        duration,
      }
    }
    catch (error) {
      this.logger.error('MFA status synchronization failed', error)
      throw error
    }
  }
}
