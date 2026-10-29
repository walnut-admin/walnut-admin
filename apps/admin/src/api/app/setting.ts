import type { AppSettings } from '@walnut/api-types'
import type { AppSettingPrivate, AppSettingPublic } from '../types/frontend-shapes'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

const appSetting = {
  PUBLIC: '/app/setting/public',
  PRIVATE: '/app/setting/private',
  REFRESH_CACHE: '/app/setting/cache/refresh',
} as const

export const appSettingAPI = new BaseAPI<AppSettings>({
  model: 'app',
  section: 'setting',
})

/**
 * @description get public settings
 */
export function getPublicSettingsAPI() {
  return AppAxios.get<AppSettingPublic>({
    url: appSetting.PUBLIC,
    _cancelOnRouteChange: false,
  })
}

/**
 * @description get private settings
 */
export function getPrivateSettingsAPI() {
  return AppAxios.get<AppSettingPrivate>({
    url: appSetting.PRIVATE,
  })
}

/**
 * @description refresh app settings cache
 */
export function refreshAppSettingsCacheAPI() {
  return AppAxios.post<boolean>({
    url: appSetting.REFRESH_CACHE,
  })
}
