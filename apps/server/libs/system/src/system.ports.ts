import type { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import type { IWalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import type { EntityManager } from 'typeorm'

/**
 * libs/system 的依赖反转端口（libs 解耦批 7）。
 *
 * 背景：system 域下沉 libs/system 后，仍有两条跨层能力的窄耦合 —— 认证日志的失败登录
 * 风控收集（实现在 `libs/security`）、设备详情页的在线用户读取（实现在
 * `libs/app-domain` 的监控仓储）。它们不是 system 能自己实现的能力，按批 2-6 的既有手法
 * 收成窄接口；绑定在实现所在 lib 的 @Global 模块（`SecurityRiskModule` /
 * `AppMonitorUserRepositoryModule`），依赖方向仍为「上层 → system」单向。
 * 缺绑定 = 启动期 DI 报错（必需注入），不会静默跳过。
 */

// ─── 失败登录风控收集（libs/security/src/risk/modules/failedLogin.service）───────

/** 认证日志只传这五个字段（SecurityRiskFailedLoginService.collect 的结构性子集） */
export interface ISystemFailedLoginRiskPayload {
  identifier?: string
  loginType: IWalnutAdminConstDecoratorLogAuthType
  deviceId: string
  ip: string
  reason: string
}

export const WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR = Symbol('WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR')

export interface IWalnutAdminSystemFailedLoginRiskCollector {
  collect: (payload: ISystemFailedLoginRiskPayload) => Promise<unknown>
}

// ─── 设备当前在线用户（libs/app-domain/src/monitor/user/repo/user.repo.service）────

/** 设备详情页只读这三列（sys_user 投影） */
export interface ISystemMonitorActiveUser {
  id: string
  userName: string | null
  nickName: string | null
}

export const WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER = Symbol('WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER')

export interface IWalnutAdminSystemMonitorActiveUserReader {
  findActiveUserByDeviceId: (deviceId: string) => Promise<ISystemMonitorActiveUser | null>
}

// ─── 设备封禁踢下线（拍板-4：auth 的会话/令牌腿 + app 的 socket 腿）───────────────

/**
 * 「封禁 = 踢下线」（review 拍板-4）。
 *
 * 封禁原先只写 sys_device.banned：已封设备仍能 POST /auth/refresh 续 AT、WebSocket 连接
 * 也不断（socket 握手只验 JWT + 会话键），审计上表现为「封了还在动」。本端口把「撤该设备
 * 全部 RT → 清该设备上各用户的会话/权限/MFA 缓存 → 断开该设备的 WS 连接」收成一次调用。
 *
 * 实现不在 system 层：它要用 libs/auth 的 refresh/session 与 app 的 SocketService
 * （依赖方向是「上层 → system」单向，同本文件另两个端口）。绑定在实现所在层的 @Global
 * 模块（app 的 SysDeviceKickModule）；缺绑定 = 启动期 DI 报错，不会静默跳过。
 */
export const WALNUT_ADMIN_SYSTEM_DEVICE_KICKER = Symbol('WALNUT_ADMIN_SYSTEM_DEVICE_KICKER')

export interface IWalnutAdminSystemDeviceKicker {
  /**
   * @param deviceId 业务键 sys_device.device_id
   * @param revokeReason 写进 auth_refresh_token.revoke_reason（CHECK 值集：deviceBanned）
   * @param em 事务句柄：RT 撤销与封禁写同事务提交（回滚则谁都不生效）
   */
  kickDevice: (
    deviceId: string,
    revokeReason: IWalnutAdminConstRevokeRTType,
    em?: EntityManager,
  ) => Promise<unknown>
}
