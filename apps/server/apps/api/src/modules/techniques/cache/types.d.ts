import type { IWalnutAdminConstAppCacheType } from '@walnut/const/app/cache'

declare global {
  interface IWalnutAdminCacheOptions {
    start?: number
    t: IWalnutAdminConstAppCacheType
    ttl?: number
  }
}

export {}
