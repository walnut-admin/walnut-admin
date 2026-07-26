import type { IWalnutAdminConstAppSettingForceQuitStrategy } from '@walnut-server/const/app/setting'

declare global {
  type IWalnutAdminSocketEvents =
    | 'lock:lock'
    | 'lock:unlock'
    | 'force:quit'

  interface IWalnutAdminSocketEventDataMap {
    'lock:lock': object
    'lock:unlock': object
    'force:quit': {
      strategy: IWalnutAdminConstAppSettingForceQuitStrategy
    }
  }

  type IWalnutAdminSocketRoom = `user:${string}:${string}`
}

export {}
