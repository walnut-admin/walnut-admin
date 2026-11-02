import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { SysUserRepositoryService } from '../../user/repo/user.repo.service'
import { AuthMfaStatusDTO } from '../dto/user_mfa.dto'
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
   *
   * P2-24（2026-10-29）：判据统一为**用户 + 类型集合**，与
   * `updateMfaSetupStatusForCronJob` 同源（`sys_user.mfa_setup` 也是用户级标志）。
   *
   * 旧实现走 `getCurrentUserMfaSetupStatus` 的「类型 + 当前设备」：webauthn 按
   * `(userId, deviceId)` 计数，用户在设备 A、B 各注册一个 webauthn 时 cron 把
   * `mfa_setup` 置 true，但设备 A 上 verify 只看到 1 种 → 恒 40000（登录后死锁）。
   * 这里跨设备按类型去重：任一设备注册的 webauthn 都算该用户具备 webauthn 方法。
   * `getCurrentUserMfaSetupStatus` 仍保留设备维度（前端「本设备可用方法」展示用）。
   */
  async getIsCurrentUserMfaVerified(userId: string, em?: EntityManager) {
    const mfaConfig = await this.cacheAppSettingsService.getAuthMfaConfig()
    const requiredCount = mfaConfig.methodsRequiredCount

    const enabledTypeCount = await this.sysUserMfaRepoService.countEnabledMfaTypesByUserId(userId, em)

    return enabledTypeCount >= requiredCount
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

      // 2. Aggregate enabled MFA **types** per user（P2-24：跨设备按类型去重，与运行时同源）
      const userMfaStats = await this.sysUserMfaRepoService.aggregateMfaTypeStats()

      this.logger.log(`Found ${userMfaStats.length} users with MFA devices`)

      // 3. Update users with MFA devices
      let verifiedCount = 0
      let unverifiedCount = 0

      for (const stat of userMfaStats) {
        const shouldBeVerified = stat.typeCount >= requiredCount

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
