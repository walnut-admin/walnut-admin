import type { IIdentitySignoutService } from '@walnut-server/identity'
import type { EntityManager } from 'typeorm'
import type { IAuthMonitorService, IAuthRiskService } from '../../auth.ports'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { AppTechCacheMfaService } from '@walnut-server/cache'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { registerAfterCommitHook, runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { SysMenuSharedService } from '@walnut-server/system'
import { WALNUT_ADMIN_AUTH_MONITOR_SERVICE, WALNUT_ADMIN_AUTH_RISK_SERVICE } from '../../auth.ports'
import { AuthRefreshSharedService } from '../refresh/shared/refresh.shared.service'
import { AuthSessionService } from '../session/session.service'

// Note: Signout payload types are now defined in types.d.ts using declare global

/**
 * B7b 归一：revoke RT 的 refresh 写腿迁 PG —— `dbSession: ClientSession` 改为
 * `em?: EntityManager`（事务句柄由调用方传入 ctx.em）。
 */
@Injectable()
/**
 * 批 6：implements 是端口绑定的编译期守护。身份内核的 user_device.forceQuit 只经
 * WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE 调本服务的 user-kick-other 分支。
 */
export class AuthSignoutService implements IIdentitySignoutService {
  private readonly logger = new Logger(AuthSignoutService.name)

  constructor(
    private readonly sysMenuSharedService: SysMenuSharedService,
    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly authSessionService: AuthSessionService,
    private readonly cacheMfaService: AppTechCacheMfaService,
    // 批 8：security 域事后风险清理与 app 在线监控踢人走端口，实现绑定在组合根
    @Inject(WALNUT_ADMIN_AUTH_RISK_SERVICE)
    private readonly riskService: IAuthRiskService,
    @Inject(WALNUT_ADMIN_AUTH_MONITOR_SERVICE)
    private readonly appMonitorUserSharedService: IAuthMonitorService,
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
   * B7（批次 7）：**凭 RT 登出** —— AT 过期也撤得掉现役 RT。
   *
   * 为什么身份从 RT 认：`POST /auth/signout` 的正文是「删掉 DB 里的 refresh token」，
   * 本质上是以 RT 为凭据的操作（拍板 Q4-a）。
   * 此前它挂在 `JwtAccessGuard` 后面：AT 一过期就 40101，用户既登不出去，服务端那枚
   * RT 还继续现役 —— 正是本方法要消灭的形态。
   *
   * 身份来源唯一：`RT_JTI` cookie → `auth_refresh_token` 行（`JwtRefreshGuard` 已在
   * 入口验过「行未撤销 + RT 签名有效」）。deviceId 取**行上的值**，cookie 里的
   * `DEVICE_ID` 只做一致性核对，不一致直接 40102 —— 与刷新链「cookie deviceId == 行
   * deviceId」同口径，防的是「A 设备的 cookie 去撤 B 设备的 RT」。
   */
  async signoutByRefreshJti(
    payload: { jti: string, sid: string, deviceId: string, ip: string },
    em?: EntityManager,
  ) {
    const owner = await this.authRefreshSharedService.getRefreshSessionOwner(payload.jti)
    if (owner.deviceId !== payload.deviceId) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    await this.doSignout(owner.userId, {
      trigger: 'user-logout',
      deviceId: owner.deviceId,
      sid: payload.sid,
      ip: payload.ip,
    }, em)
  }

  /**
   * 设备封禁踢下线（review 拍板-4）—— **按设备**而不是按用户。
   *
   * 封禁原先只写 sys_device.banned：
   * - `POST /auth/refresh` 是 DeviceFree 且只校验「cookie deviceId == RT 行 deviceId」，
   *   已封设备可以无限续 AT；
   * - WebSocket 握手只验 JWT + 会话键，已建立的连接照收实时事件。
   *
   * 这里把该设备上**所有用户**的会话断干净：
   * 1. 撤该设备的全部现役 RT（reason = deviceBanned，与封禁写**同一事务**）；
   * 2. 事务提交后按 userId 清会话键 / 权限缓存 / MFA verified 缓存（与 clearKickedDeviceCache
   *    同一批键）—— 坑在于不能让缓存清扫跟着回滚误清，所以走 runAfterCommit；
   * 3. socket 侧由调用方（app 的 kicker）在提交后断开。
   *
   * @returns 受影响的 userId 列表
   */
  async kickDeviceOffline(
    deviceId: string,
    revokeReason: IWalnutAdminConstRevokeRTType = WalnutAdminConstRevokeRTType.deviceBanned,
    em?: EntityManager,
  ) {
    // F4 同款：空 deviceId 不得升级成「全设备吊销」语义（update 的 where 会退化成宽条件）
    if (!this.isValidDeviceId(deviceId)) {
      this.logger.warn('Device kick skipped: empty deviceId')
      return []
    }

    const userIds = await this.authRefreshSharedService.revokeRTForDevice(deviceId, em, revokeReason)

    this.logger.log(`Device kick - revoked RT for device: ${deviceId}, affected users: ${userIds.length}`)

    await runAfterCommit(async () => {
      for (const userId of userIds) {
        await this.clearKickedDeviceCache(userId, deviceId)
      }

      this.logger.log(`Device kick - cleared sessions for device: ${deviceId}`)
    })

    return userIds
  }

  /**
   * 场景1: 用户主动退出登录
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

    // 事务提交后清理缓存
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
   * 清理单个设备的缓存
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
