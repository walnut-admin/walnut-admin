import { Injectable } from '@nestjs/common'
import { IWalnutAdminScopeResolverConfig, WalnutAdminConstAppSettingScopeType } from '@walnut-server/const/app/setting'

@Injectable()
export class SharedScopeResolverService {
  /**
   * Unified resolution method
   * @param config  Configuration for the business field (e.g., role mode, theme, etc.)
   * @param target  Local entity (user / organization / project �?
   * @returns       The final effective value
   */
  resolve<T>(config: IWalnutAdminScopeResolverConfig<T>, target?: Record<string, any>): T {
    if (config.scope === WalnutAdminConstAppSettingScopeType.GLOBAL) {
      return config.globalValue
    }
    // Local mode: prefer the field from the target; fallback to globalValue if absent
    if (target && typeof target === 'object' && config.localKey in target) {
      return target[config.localKey] as T
    }
    return config.globalValue
  }
}
