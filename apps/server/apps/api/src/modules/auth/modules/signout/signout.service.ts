import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { registerAfterCommitHook } from '@walnut-server/db'
import { AppMonitorUserSharedService } from '@/modules/app/monitor/user/shared/user.shared.service'
import { SecurityRiskService } from '@/modules/security/risk/risk.service'
import { SysMenuSharedService } from '@/modules/system/menu/shared/menu.shared.service'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AuthRefreshSharedService } from '../refresh/shared/refresh.shared.service'
import { AuthSessionService } from '../session/session.service'

// Note: Signout payload types are now defined in types.d.ts using declare global

/**
 * B7b 归一：revoke RT 的 refresh 写腿迁 PG —— `dbSession: ClientSession` 改为
 * `em?: EntityManager`（事务句柄由调用方传入 ctx.em）。
 */
@Injectable()
export class AuthSignoutService {
  private readonly logger = new Logger(AuthSignoutService.name)

  constructor(
    private readonly sysMenuSharedService: SysMenuSharedService,
    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly authSessionService: AuthSessionService,
    private readonly cacheMfaService: AppTechCacheMfaService,
    private readonly riskService: SecurityRiskService,
    private readonly appMonitorUserSharedService: AppMonitorUserSharedService,
  ) { }

  /**
   * Execute logout operation
   */
  async doSignout(userId: string, payload: IWalnutAdminSignoutPayload, em?: EntityManager) {
    switch (payload.trigger) {
      case 'user-logout':
        await this.handleUserLogout(userId, payload, em)
        break
      case 'user-kick-other':
        await this.handleUserKickOther(userId, payload, em)
        break
      case 'admin-kick':
        await this.handleAdminKick(userId, payload, em)
        break
      case 'security-policy':
        await this.handleSecurityPolicy(userId, payload, em)
        break
    }
  }

  /**
   * 场景1: 用户主动退出登�?
   * - Directly revoke RT + clear cache
   */
  private async handleUserLogout(
    userId: string,
    payload: IWalnutAdminUserLogoutPayload,
    em?: EntityManager,
  ) {
    const { deviceId, sid, ip } = payload

    // 撤销 refresh token
    await this.authRefreshSharedService.revokeRTForUserDevice(userId, deviceId, em)

    // 事务提交后清理缓�?
    registerAfterCommitHook(async () => {
      await this.clearDeviceCache(userId, deviceId, sid, ip)
      this.logger.log(`User logout completed - user: ${userId}, device: ${deviceId}`)
    })
  }

  /**
   * 场景2: 用户踢下线自己的其他设备
   * - 在线：只�?socket 通知（前端会主动调用退出接口）
   * - 离线：只 revoke RT（用户下次打开页面 socket 初始化时会触发前端调用接口）
   */
  private async handleUserKickOther(
    userId: string,
    payload: IWalnutAdminUserKickOtherPayload,
    em?: EntityManager,
  ) {
    const { deviceId, fingerprint, isOnline } = payload

    // revoke RT + 更新revoke reason
    await this.authRefreshSharedService.revokeRTForUserDevice(userId, deviceId, em, WalnutAdminConstRevokeRTType.userKickOther)
    this.logger.log(`User kick other - revoked RT for offline device: ${deviceId}`)

    // 在线设备：发 socket 通知（使用用户踢其他设备的提示）
    if (isOnline) {
      await this.appMonitorUserSharedService.forceQuitMonitorBySocket(userId, fingerprint, WalnutAdminConstRevokeRTType.userKickOther)
      this.logger.log(`User kick other - notified online device: ${deviceId}`)
    }
  }

  /**
   * 场景3: 管理员踢单点设备
   * - 在线：只�?socket 通知（前端会主动调用退出接口）
   * - 离线：只 revoke RT（用户下次打开页面 socket 初始化时会触发前端调用接口）
   */
  private async handleAdminKick(
    userId: string,
    payload: IWalnutAdminAdminKickPayload,
    em?: EntityManager,
  ) {
    const { deviceId, fingerprint, revokeReason, isOnline } = payload

    // 离线设备：只 revoke RT
    await this.authRefreshSharedService.revokeRTForUserDevice(userId, deviceId, em, revokeReason)
    this.logger.log(`Admin kick - revoked RT for offline device: ${deviceId}`)

    if (isOnline) {
      // 在线设备：只�?socket 通知
      await this.appMonitorUserSharedService.forceQuitMonitorBySocket(userId, fingerprint, revokeReason)
      this.logger.log(`Admin kick - notified online device: ${deviceId}`)
    }
  }

  /**
   * 场景4: 敏感操作 - 踢所有设�?
   * - revoke 所�?RT（包括离线设备）
   * - 通知在线设备（前端会主动调用退出接口）
   */
  private async handleSecurityPolicy(
    userId: string,
    payload: IWalnutAdminSecurityPolicyPayload,
    em?: EntityManager,
  ) {
    const { revokeReason } = payload

    // revoke 所有设备的 RT 并记录 revoke 原因
    await this.authRefreshSharedService.revokeRTForUser(userId, em, revokeReason)

    // 事务提交后通知在线设备
    registerAfterCommitHook(async () => {
      await this.appMonitorUserSharedService.forceQuitMonitorsBySocket(userId, revokeReason)
      this.logger.log(`Security policy - revoked all RT and notified online devices for user: ${userId}`)
    })
  }

  /**
   * 清理单个设备的缓�?
   * @description 只在用户主动退出登录时调用
   */
  private async clearDeviceCache(
    userId: string,
    deviceId: string,
    sid: string,
    ip: string,
  ) {
    await Promise.all([
      this.sysMenuSharedService.delPermissionFromCache(userId, deviceId),
      this.authSessionService.revokeSession(userId, deviceId, sid),
      this.cacheMfaService.delVerifiedCache(userId, deviceId),
      this.riskService.clearPostAuthRiskResult({ userId, deviceId, ip }),
    ])

    this.logger.debug(`Cleared cache for user: ${userId}, device: ${deviceId}`)
  }
}
