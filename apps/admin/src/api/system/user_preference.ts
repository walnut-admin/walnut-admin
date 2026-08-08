import type { IResponseData } from '../response'
import type { IStoreUser } from '@/store/types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

// get user preference
export function getPreferenceAPI() {
  return AppAxios.get<IResponseData.System.User.Preference>(
    {
      url: SystemEndpointRoutes.USER_PREFERENCE_READ,
    },
  )
}

// update basic
export function updatePreferenceBasicAPI(payload: IStoreUser.Preference.Basic) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_PREFERENCE_BASIC,
      data: payload,
    },
  )
}

// update accessibility
export function updateAccessibilityPreferenceAPI(payload: IStoreUser.Preference.Accessibility) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_PREFERENCE_ACCESSIBILITY,
      data: payload,
    },
  )
}

// update theme
export function updateThemePreferenceAPI(payload: IStoreUser.Preference.Theme) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_PREFERENCE_THEME,
      data: payload,
    },
  )
}

// update layout
export function updateLayoutPreferenceAPI(payload: IStoreUser.Preference.Layout) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_PREFERENCE_LAYOUT,
      data: payload,
    },
  )
}
