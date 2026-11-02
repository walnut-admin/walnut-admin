import type { LocaleType } from '@walnut/contract'
import type { EntityManager } from 'typeorm'

/**
 * 身份内核的依赖反转端口（libs 解耦批 6）。
 *
 * 背景：user / user_identity / user_oauth / user_mfa / user_device / user_lock /
 * user_preference 七个身份栈模块原先直接 import auth（OTP / MFA post-verification /
 * signout）、app（在线监控 / socket / device 注册表）与 system（data-scope）的
 * 具体服务 —— 这正是 auth ↔ system 的最大一条环。本批把「内核需要的少量能力」
 * 收成窄接口；绑定跟随实现所在层 —— 多数落在 `libs/auth` / `libs/system` /
 * `libs/app-domain` 各自的 @Global 模块，仅 socket 通知（USER_NOTIFIER）依赖
 * app 专属能力而留在 app 的 `AppMonitorUserSharedModule`。依赖方向因此收敛为
 * 「上层 lib / app → identity 内核」单向。
 *
 * 绑定缺失 = 启动期 DI 报错（必需注入），不会退化成静默跳过。
 */

// ─── OTP（auth/modules/otp/shared/otp.shared.service）───────────────────────────

/** OTP 通道类型（原 auth otp.const 的 IOtpType；auth 侧 re-export 保持旧 import 面） */
export type IOtpType = 'email' | 'sms'

export const WALNUT_ADMIN_IDENTITY_OTP_SERVICE = Symbol('WALNUT_ADMIN_IDENTITY_OTP_SERVICE')

export interface IIdentityOtpService {
  sendVerifyCode: (type: IOtpType, identifier: string, language: LocaleType, userId?: string) => Promise<boolean>
  verifyCode: (type: IOtpType, identifier: string, code: string, userId?: string) => Promise<boolean>
}

// ─── MFA 验证后置动作（auth/modules/mfa/mfa.post.service）───────────────────────

export interface IIdentityMfaPostVerificationResult {
  accessToken: string
  jti: string
}

export const WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION = Symbol('WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION')

export interface IIdentityMfaPostVerification {
  handlePostVerification: (
    trusted: boolean,
    jti: string,
    sessionId: string,
    userId: string,
    deviceId: string,
    em?: EntityManager,
  ) => Promise<IIdentityMfaPostVerificationResult>
}

// ─── 设备踢下线（auth/modules/signout/signout.service 的 user-kick-other 分支）────

/** user_device.forceQuit 只走 user-kick-other 一种触发因，按窄形状收口 */
export interface IIdentitySignoutPayload {
  trigger: 'user-kick-other'
  deviceId: string
  fingerprint: string
  isOnline: boolean
}

export const WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE = Symbol('WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE')

export interface IIdentitySignoutService {
  doSignout: (userId: string, payload: IIdentitySignoutPayload, em?: EntityManager) => Promise<void>
}

// ─── 数据权限缓存失效（system/data-scope/data-scope.service）────────────────────

export const WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR = Symbol('WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR')

export interface IIdentityDataScopeInvalidator {
  invalidateForUser: (userId: string) => Promise<void>
}

// ─── 在线监控仓储（app/monitor/user/repo/user.repo.service）─────────────────────

/** user_device 只读这几列（visitorId / auth / left / lastActiveAt），按窄形状收口 */
export interface IIdentityMonitorUserRow {
  visitorId: string
  auth: boolean
  left: boolean
  lastActiveAt: Date
}

export const WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY = Symbol('WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY')

export interface IIdentityMonitorRepository {
  findFirstByDeviceId: (deviceId: string, em?: EntityManager) => Promise<IIdentityMonitorUserRow | null>
  findByUserIdAndDeviceId: (userId: string, deviceId: string, em?: EntityManager) => Promise<IIdentityMonitorUserRow | null>
  findActiveByDeviceId: (deviceId: string) => Promise<IIdentityMonitorUserRow | null>
  delMonitorByDeviceId: (deviceId: string) => Promise<IIdentityMonitorUserRow | null>
}

// ─── 在线监控 socket 通知（app/monitor/user/shared/user.shared.service）─────────

/** user_lock 只发 lock/unlock 两个事件 */
export type IIdentitySocketEvent = 'lock:lock' | 'lock:unlock'

export const WALNUT_ADMIN_IDENTITY_USER_NOTIFIER = Symbol('WALNUT_ADMIN_IDENTITY_USER_NOTIFIER')

export interface IIdentityUserNotifier {
  sendSocketEventToUserAllMonitors: (userId: string, event: IIdentitySocketEvent, data?: object) => Promise<void>
  sendSocketEventToUserDevice: (userId: string, fingerprint: string, event: IIdentitySocketEvent) => void
}

// ─── 设备注册表（system/device 的 repo + shared service）────────────────────────

/** user_device / cron 只读这几列 */
export interface IIdentityDeviceRow {
  deviceId: string
  deviceName?: string | null
  deviceInfo?: { type?: unknown } | null
  locationInfo?: { country?: unknown, region?: unknown, city?: unknown } | null
}

export const WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE = Symbol('WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE')

export interface IIdentityDeviceService {
  findDeviceByDeviceId: (deviceId: string, em?: EntityManager) => Promise<IIdentityDeviceRow | null>
  getDeviceNameByDeviceId: (deviceId: string, em?: EntityManager) => Promise<string>
  getAllActiveDevices: () => Promise<IIdentityDeviceRow[]>
  deleteNonMonitorUserDevice: (deviceId: string) => Promise<IIdentityDeviceRow | null>
  updateDeviceActive: (deviceId: string, active: boolean, em?: EntityManager) => Promise<boolean>
}
