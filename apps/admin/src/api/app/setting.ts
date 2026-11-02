import type { AppSettings } from '@walnut/api-types'
import type { AppSettingPrivate, AppSettingPublic } from '../types/frontend-shapes'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const appSettingAPI = new BaseAPI<AppSettings>({
  model: 'app',
  section: 'setting',
})

/**
 * @description get public settings
 */
export function getPublicSettingsAPI() {
  return AppAxios.get<AppSettingPublic>({
    url: AppRoutes.SETTING_PUBLIC,
    _cancelOnRouteChange: false,
  })
}

/**
 * @description get private settings
 */
export function getPrivateSettingsAPI() {
  return AppAxios.get<AppSettingPrivate>({
    url: AppRoutes.SETTING_PRIVATE,
  })
}

/**
 * @description refresh app settings cache
 */
export function refreshAppSettingsCacheAPI() {
  return AppAxios.post<boolean>({
    url: AppRoutes.SETTING_CACHE_REFRESH,
  })
}
