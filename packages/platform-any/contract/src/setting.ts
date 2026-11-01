/**
 * App setting constants — shared between frontend and backend.
 * Only the force-quit surface is shared；setting key literals stay in server.
 *
 * `WalnutAdminConstAppSettingForceQuitStrategy` / `IWalnutAdminConstAppSettingForceQuit`
 * 是前后端共用的 reason → strategy 映射：server 侧以它作为 force-quit 配置的默认值与
 * 出参类型（cache.appSettings），admin 侧 socket 的 `force:quit` 事件按该策略值决定
 * 退出交互（倒计时弹窗 / 立即登出 / 手动倒计时，apps/admin/src/socket/index.ts）。
 * 两侧同源，改值集必须同时考虑这两处消费。
 */

import type { ValueOf } from 'easy-fns-ts'

/** Force quit strategy for a user whose credential / session is invalidated */
export const WalnutAdminConstAppSettingForceQuitStrategy = {
  FORCE_COUNTDOWN_MODAL: 'FORCE_COUNTDOWN_MODAL',
  MANUAL_COUNTDOWN_MODAL: 'MANUAL_COUNTDOWN_MODAL',
  FORCE_IMMEDIATE_SIGNOUT: 'FORCE_IMMEDIATE_SIGNOUT',
} as const

export type IWalnutAdminConstAppSettingForceQuitStrategy = ValueOf<typeof WalnutAdminConstAppSettingForceQuitStrategy>

/** Force quit setting keys — every reason maps to a strategy */
export interface IWalnutAdminConstAppSettingForceQuit {
  updatePass: IWalnutAdminConstAppSettingForceQuitStrategy
  resetPass: IWalnutAdminConstAppSettingForceQuitStrategy
  updateEmail: IWalnutAdminConstAppSettingForceQuitStrategy
  updatePhoneNumber: IWalnutAdminConstAppSettingForceQuitStrategy
  forceQuitOnline: IWalnutAdminConstAppSettingForceQuitStrategy
  forceQuitOffline: IWalnutAdminConstAppSettingForceQuitStrategy
  currentRoleBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  currentUserBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  deviceBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  deviceHighRisk: IWalnutAdminConstAppSettingForceQuitStrategy
  versionUpgrade: IWalnutAdminConstAppSettingForceQuitStrategy
  userKickOther: IWalnutAdminConstAppSettingForceQuitStrategy
}
