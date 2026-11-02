import type { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'

/**
 * libs/auth 对外界能力的依赖反转端口（libs 解耦批 8）。
 *
 * auth 域下沉 libs/auth 后，仍有两条跨层能力的窄耦合：登出链的**事后风险缓存清理**
 * （security 域）与**在线监控 socket 踢人**（monitor 的 socket 面，依赖 app 专属能力）。
 * 它们不是 auth 能自己实现的能力，按批 2-7 的既有手法收成窄接口：token 声明在需求方
 * （本 lib），绑定跟随实现所在层 —— security 侧在 `libs/security` 的 `SecurityRiskModule`，
 * socket 侧在 app 的 `AppMonitorUserSharedModule`。
 *
 * 依赖方向因此固定为 security → auth（sensitive 的 OTP 校验只走 libs/auth），
 * auth 不再 import security / app。缺绑定 = 启动期 DI 报错（必需注入），不会静默跳过。
 */

// ─── 事后风险缓存清理（libs/security 的 SecurityRiskService）────────────────────

/** 登出只清这三元组对应的 post-auth 风险缓存（SecurityRiskService.clearPostAuthRiskResult 子集） */
export interface IAuthRiskService {
  clearPostAuthRiskResult: (params: {
    userId?: string
    deviceId: string
    ip: string
  }) => Promise<unknown>
}

export const WALNUT_ADMIN_AUTH_RISK_SERVICE = Symbol('WALNUT_ADMIN_AUTH_RISK_SERVICE')

// ─── 在线监控 socket 踢人（app/monitor/user/shared/user.shared.service）─────────

export interface IAuthMonitorService {
  forceQuitMonitorBySocket: (
    userId: string,
    visitorId: string,
    revokeReason?: IWalnutAdminConstRevokeRTType,
  ) => Promise<unknown>
  forceQuitMonitorsBySocket: (
    userId: string,
    revokeReason: IWalnutAdminConstRevokeRTType,
  ) => Promise<unknown>
}

export const WALNUT_ADMIN_AUTH_MONITOR_SERVICE = Symbol('WALNUT_ADMIN_AUTH_MONITOR_SERVICE')
