import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { registerAfterCommitHook, runAfterCommit } from '@walnut-server/db'
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
   * - 在线：socket 通知（前端会主动调用退出接口）
   * - 离线：revoke RT + 设备级缓存清扫
   *
   * P2-12（2026-10-28）：只撤 RT 不够 —— P0-4 起 JWT validate 按
   * `AUTH:SESSIONS:<user>:<device>:<sid>` 判会话存在，若不清会话键，被踢设备的 AT
   * 在到期前仍然可用。这里与 signout 的 clearDeviceCache 对齐：按设备清会话 / 权限 /
   * MFA verified 三键（事务提交后执行，回滚不误清）。
   */
  private async handleUserKickOther(
    userId: string,
    payload: IWalnutAdminUserKickOtherPayload,
    em?: EntityManager,
  ) {
    const { deviceId, fingerprint, isOnline } = payload

    // F4（2026-10-28）：空 deviceId 不得升级为全设备吊销（TypeORM 会忽略 undefined
    // 条件；revokeSession 的 deviceId 缺省语义是「该用户全部设备」）。无法定位设备时
    // 整个踢人动作受控跳过，只留 warn，不做任何宽范围撤销。
    if (!this.isValidDeviceId(deviceId)) {
      this.logger.warn(`User kick other skipped: empty deviceId (user=${userId})`)
      return
    }

    // revoke RT + 更新revoke reason
    await this.authRefreshSharedService.revokeRTForUserDevice(userId, deviceId, em, WalnutAdminConstRevokeRTType.userKickOther)
    this.logger.log(`User kick other - revoked RT for offline device: ${deviceId}`)

    // 在线设备：发 socket 通知（使用用户踢其他设备的提示）
    if (isOnline) {
      await this.appMonitorUserSharedService.forceQuitMonitorBySocket(userId, fingerprint, WalnutAdminConstRevokeRTType.userKickOther)
      this.logger.log(`User kick other - notified online device: ${deviceId}`)
    }

    // 事务提交后清该设备的会话 / 权限 / MFA 缓存（AT 立即失效，不等到期）
    await runAfterCommit(async () => {
      await this.clearKickedDeviceCache(userId, deviceId)
      this.logger.log(`User kick other completed - user: ${userId}, device: ${deviceId}`)
    })
  }

  /**
   * 场景3: 管理员踢单点设备
   * - 在线：socket 通知（前端会主动调用退出接口）
   * - 离线：revoke RT + 设备级缓存清扫（P2-12 同款，AT 立即失效）
   */
  private async handleAdminKick(
    userId: string,
    payload: IWalnutAdminAdminKickPayload,
    em?: EntityManager,
  ) {
    const { deviceId, fingerprint, revokeReason, isOnline } = payload

    // F4：同 handleUserKickOther —— 空 deviceId 不做任何宽范围撤销
    if (!this.isValidDeviceId(deviceId)) {
      this.logger.warn(`Admin kick skipped: empty deviceId (user=${userId})`)
      return
    }

    // 离线设备：只 revoke RT
    await this.authRefreshSharedService.revokeRTForUserDevice(userId, deviceId, em, revokeReason)
    this.logger.log(`Admin kick - revoked RT for offline device: ${deviceId}`)

    if (isOnline) {
      // 在线设备：只发 socket 通知
      await this.appMonitorUserSharedService.forceQuitMonitorBySocket(userId, fingerprint, revokeReason)
      this.logger.log(`Admin kick - notified online device: ${deviceId}`)
    }

    // 事务提交后清该设备的会话 / 权限 / MFA 缓存（P2-12）
    await runAfterCommit(async () => {
      await this.clearKickedDeviceCache(userId, deviceId)
      this.logger.log(`Admin kick completed - user: ${userId}, device: ${deviceId}`)
    })
  }

  /**
   * 场景4: 敏感操作（改密等）- 踢所有设备
   * - revoke 所有 RT（包括离线设备）
   * - 清全部设备的会话 / 权限 / MFA verified 三键（P2-32，2026-10-29）
   * - 通知在线设备（前端会主动调用退出接口）
   *
   * P2-32 的依据：P0-4 起 JWT validate 只认 `AUTH:SESSIONS` 会话键存在与否 ——
   * 只撤 RT 的话旧 AT 在会话键 TTL 内继续可用，「改密即全端下线」只兑现了 RT 面。
   * 改密语义是**全设备**，因此这里不传 deviceId（`revokeSession(userId)` 即全设备）
   * 并按 `<userId>:*` 前缀清权限 / MFA 缓存。
   */
  private async handleSecurityPolicy(
    userId: string,
    payload: IWalnutAdminSecurityPolicyPayload,
    em?: EntityManager,
  ) {
    const { revokeReason } = payload

    // revoke 所有设备的 RT 并记录 revoke 原因
    await this.authRefreshSharedService.revokeRTForUser(userId, em, revokeReason)

    // 事务提交后清全设备缓存 + 通知在线设备
    await runAfterCommit(async () => {
      await Promise.all([
        this.authSessionService.revokeSession(userId),
        this.sysMenuSharedService.clearUserPermissionsCache(userId),
        this.cacheMfaService.delVerifiedCacheForUser(userId),
      ])
      await this.appMonitorUserSharedService.forceQuitMonitorsBySocket(userId, revokeReason)
      this.logger.log(`Security policy - revoked all RT and cleared all-device caches for user: ${userId}`)
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

  /**
   * 踢下线（force-quit / admin-kick）的设备级缓存清扫 —— 与 clearDeviceCache 同款三键，
   * 但不需要 sid / ip：按设备维度吊销该设备的全部会话（`AUTH:SESSIONS:<user>:<device>:*`）。
   *
   * F4：deviceId 为空时绝不能落到「该用户全部设备」——`revokeSession(userId, undefined)`
   * 的语义正是全设备吊销。这里再兜一层，调用方跳过时也只留 warn。
   */
  private async clearKickedDeviceCache(userId: string, deviceId: string) {
    if (!this.isValidDeviceId(deviceId)) {
      this.logger.warn(`Skip kicked-device cache cleanup: empty deviceId (user=${userId})`)
      return
    }

    await Promise.all([
      this.sysMenuSharedService.delPermissionFromCache(userId, deviceId),
      this.authSessionService.revokeSession(userId, deviceId),
      this.cacheMfaService.delVerifiedCache(userId, deviceId),
    ])

    this.logger.debug(`Cleared kicked device cache for user: ${userId}, device: ${deviceId}`)
  }

  private isValidDeviceId(deviceId: unknown): deviceId is string {
    return typeof deviceId === 'string' && deviceId.length > 0
  }
}
